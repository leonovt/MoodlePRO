from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import audio_extract, video_fetch
from config import WorkerSettings
from transcriber import FakeTranscriber
from worker import run_once


@pytest.fixture(autouse=True)
def fake_server_pipeline(monkeypatch):
    """Stub the server's download/ffmpeg steps so /jobs works without real network/ffmpeg."""

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


async def test_claim_on_empty_queue_returns_no_job_not_500(fake_redis):
    """An idle worker long-polls /internal/jobs/claim with nothing queued; the BLPOP times
    out and must come back as 'no job' (200), never a 500 that would crash the worker."""
    await fake_redis.delete("queue:jobs")
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as server_client:
            resp = await server_client.post(
                "/internal/jobs/claim",
                params={"timeout": 1},
                headers={"Authorization": "Bearer test-internal-token"},
            )
            assert resp.status_code == 200
            assert resp.json()["job_id"] is None


async def test_worker_processes_a_real_job_end_to_end(fake_redis):
    """Server creates+queues a job; the (fake) GPU worker pops it, fetches audio over HTTP,
    transcribes, and reports completion back — exactly the real cross-machine contract,
    minus an actual GPU/model."""
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as server_client:
            create_resp = await server_client.post(
                "/jobs", json={"video_url": "https://example.com/lecture.mp4"}
            )
            assert create_resp.status_code == 200
            job = create_resp.json()
            assert job["status"] == "queued"

            queued_ids = [item.decode() for item in await fake_redis.lrange("queue:jobs", 0, -1)]
            assert job["id"] in queued_ids

            worker_settings = WorkerSettings(internal_api_token="test-internal-token")
            processed = await run_once(
                server_client, FakeTranscriber(), worker_settings, poll_timeout=1
            )
            assert processed is True

            status_resp = await server_client.get(f"/jobs/{job['id']}")
            body = status_resp.json()
            assert body["status"] == "completed"
            assert "שלום" in body["text"]

            srt_resp = await server_client.get(f"/jobs/{job['id']}/srt")
            assert "00:00:00,000" in srt_resp.text
