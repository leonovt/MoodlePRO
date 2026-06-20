import asyncio
from pathlib import Path

import fakeredis.aioredis as fakeredis_aio
import pytest

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import audio_extract, dedup, fallback, video_fetch
from app.services.queue import WORKER_HEARTBEAT_KEY
from app.services.srt import Segment, build_srt
from app.services.transcribe_groq import TranscriptionProvider, TranscriptionResult


@pytest.fixture(autouse=True)
def fake_pipeline(monkeypatch):
    """Stub the network/ffmpeg steps so /jobs can be exercised without real I/O."""

    async def fake_download(video_url: str, dest_dir: Path) -> Path:
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = dest_dir / "source.mp4"
        path.write_bytes(b"fake video bytes")
        return path

    def fake_extract(video_path: Path, dest_path: Path) -> Path:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(b"fake audio bytes")
        return dest_path

    monkeypatch.setattr(video_fetch, "download_video", fake_download)
    monkeypatch.setattr(audio_extract, "extract_audio", fake_extract)


class FakeProvider(TranscriptionProvider):
    def __init__(self, text: str = "groq transcript") -> None:
        self._text = text
        self.calls: list[tuple[Path, str]] = []

    async def transcribe(self, audio_path: Path, language: str) -> TranscriptionResult:
        self.calls.append((audio_path, language))
        srt = build_srt([Segment(text=self._text, start=0.0, end=2.0)])
        return TranscriptionResult(text=self._text, srt=srt, language=language)


def _fake_redis():
    return fakeredis_aio.FakeRedis.from_url(settings.redis_url)


async def test_run_groq_fallback_persists_and_completes(client, monkeypatch):
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "hash-groq-1")
    resp = await client.post("/jobs", json={"video_url": "https://example.com/x.mp4"})
    job_id = resp.json()["id"]
    assert resp.json()["status"] == "queued"

    provider = FakeProvider("groq did this")
    async with SessionLocal() as session:
        produced = await fallback.run_groq_fallback(
            session, _fake_redis(), job_id, "hash-groq-1", Path("ignored.wav"), provider, "he"
        )

    assert produced is True
    assert provider.calls  # provider was actually invoked

    status = await client.get(f"/jobs/{job_id}")
    assert status.json()["status"] == "completed"
    assert status.json()["text"] == "groq did this"
    assert (await client.get(f"/jobs/{job_id}/txt")).text == "groq did this"
    assert "groq did this" in (await client.get(f"/jobs/{job_id}/srt")).text


async def test_groq_fallback_skips_when_worker_already_done(client, internal_headers, monkeypatch):
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "hash-groq-2")
    resp = await client.post("/jobs", json={"video_url": "https://example.com/y.mp4"})
    job_id = resp.json()["id"]

    # A cluster worker completes the job first.
    await client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": "worker text", "srt": "worker srt", "language": "he"},
        headers=internal_headers,
    )

    provider = FakeProvider("groq text")
    async with SessionLocal() as session:
        produced = await fallback.run_groq_fallback(
            session, _fake_redis(), job_id, "hash-groq-2", Path("ignored.wav"), provider, "he"
        )

    assert produced is False
    assert provider.calls == []  # never paid for a Groq call
    assert (await client.get(f"/jobs/{job_id}/txt")).text == "worker text"  # not overwritten


async def test_schedule_groq_fallback_runs_after_grace(client, monkeypatch):
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "hash-groq-3")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(settings, "groq_fallback_grace_seconds", 0.0)
    monkeypatch.setattr(fallback, "GroqTranscriber", lambda: FakeProvider("scheduled groq"))

    resp = await client.post("/jobs", json={"video_url": "https://example.com/z.mp4"})
    job_id = resp.json()["id"]
    assert resp.json()["status"] == "queued"  # create_job scheduled the fallback

    for _ in range(50):
        await asyncio.sleep(0.02)
        status = await client.get(f"/jobs/{job_id}")
        if status.json()["status"] == "completed":
            break

    assert status.json()["status"] == "completed"
    assert status.json()["text"] == "scheduled groq"


async def test_worker_will_handle_returns_false_immediately_when_no_worker(monkeypatch):
    """No heartbeat present → fall back now even with a long grace period."""
    monkeypatch.setattr(settings, "groq_fallback_grace_seconds", 60.0)
    redis = _fake_redis()
    await redis.delete(WORKER_HEARTBEAT_KEY)  # fakeredis shares state across tests by URL

    loop = asyncio.get_event_loop()
    start = loop.time()
    handled = await fallback._worker_will_handle(redis, "absent-hash")
    elapsed = loop.time() - start

    assert handled is False
    assert elapsed < 1.0  # did not sit out the 60s grace


async def test_worker_will_handle_waits_then_falls_back_when_worker_idle(monkeypatch):
    """A live worker that never finishes → wait out the grace, then fall back to Groq."""
    monkeypatch.setattr(settings, "groq_fallback_grace_seconds", 0.2)
    monkeypatch.setattr(settings, "groq_fallback_poll_seconds", 0.05)
    redis = _fake_redis()
    await redis.set(WORKER_HEARTBEAT_KEY, "1", ex=30)

    loop = asyncio.get_event_loop()
    start = loop.time()
    handled = await fallback._worker_will_handle(redis, "absent-hash")
    elapsed = loop.time() - start

    assert handled is False
    assert elapsed >= 0.2  # honored the grace while a worker was alive


async def test_worker_will_handle_returns_true_when_transcript_appears(client, monkeypatch):
    """A live worker that completes → True, so Groq is skipped."""
    monkeypatch.setattr(settings, "groq_fallback_grace_seconds", 5.0)
    redis = _fake_redis()
    await redis.set(WORKER_HEARTBEAT_KEY, "1", ex=30)
    async with SessionLocal() as session:
        await dedup.save_transcript(session, "worker-done-hash", "worker text", "srt", "he")
        await session.commit()

    assert await fallback._worker_will_handle(redis, "worker-done-hash") is True


async def test_fallback_marks_job_failed_on_error(client, monkeypatch):
    """A throwing provider must leave the job 'failed', not stuck at 'queued'."""
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "hash-groq-fail")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(settings, "groq_fallback_grace_seconds", 0.0)

    class BoomProvider(TranscriptionProvider):
        async def transcribe(self, audio_path: Path, language: str) -> TranscriptionResult:
            raise RuntimeError("groq exploded")

    monkeypatch.setattr(fallback, "GroqTranscriber", lambda: BoomProvider())

    resp = await client.post("/jobs", json={"video_url": "https://example.com/boom.mp4"})
    job_id = resp.json()["id"]

    for _ in range(50):
        await asyncio.sleep(0.02)
        status = await client.get(f"/jobs/{job_id}")
        if status.json()["status"] == "failed":
            break

    assert status.json()["status"] == "failed"
    assert "groq exploded" in status.json()["error"]


async def test_worker_will_handle_false_when_cluster_disabled(monkeypatch):
    """Kill switch: even with a live worker heartbeat, a disabled cluster goes to Groq."""
    monkeypatch.setattr(settings, "cluster_enabled", False)
    monkeypatch.setattr(settings, "groq_fallback_grace_seconds", 60.0)
    redis = _fake_redis()
    await redis.set(WORKER_HEARTBEAT_KEY, "1", ex=30)  # a worker IS alive

    handled = await fallback._worker_will_handle(redis, "any-hash")
    assert handled is False  # ignored the live worker, will use Groq


async def test_create_job_does_not_enqueue_when_cluster_disabled(client, monkeypatch):
    """With the cluster off, a job must never be placed on the worker queue."""
    from app.services.queue import JOB_QUEUE_KEY

    monkeypatch.setattr(settings, "cluster_enabled", False)
    monkeypatch.setattr(settings, "groq_api_key", "")  # keep fallback a no-op for this check
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "hash-nocluster")

    redis = _fake_redis()  # shares state with the app's client by URL
    await redis.delete(JOB_QUEUE_KEY)  # fakeredis persists across tests; start clean

    resp = await client.post("/jobs", json={"video_url": "https://example.com/nc.mp4"})
    assert resp.json()["status"] == "queued"

    assert await redis.llen(JOB_QUEUE_KEY) == 0  # nothing handed to the cluster


async def test_schedule_is_noop_without_api_key(client, monkeypatch):
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "hash-groq-4")
    monkeypatch.setattr(settings, "groq_api_key", "")

    def _boom():
        raise AssertionError("GroqTranscriber must not be constructed when no key is set")

    monkeypatch.setattr(fallback, "GroqTranscriber", _boom)

    resp = await client.post("/jobs", json={"video_url": "https://example.com/w.mp4"})
    job_id = resp.json()["id"]

    await asyncio.sleep(0.05)
    assert (await client.get(f"/jobs/{job_id}")).json()["status"] == "queued"
