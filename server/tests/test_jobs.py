from pathlib import Path

import pytest

from app.services import audio_extract, video_fetch


@pytest.fixture(autouse=True)
def fake_pipeline(monkeypatch):
    """Stub out network/ffmpeg dependent steps; each test controls the hash via a fixture override."""

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


async def test_create_job_queues_and_enqueues_in_redis(client):
    response = await client.post("/jobs", json={"video_url": "https://example.com/lecture.mp4"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    job_id = body["id"]

    from fakeredis.aioredis import FakeRedis

    redis = FakeRedis.from_url("redis://localhost:6379/0")
    queued_ids = [item.decode() for item in await redis.lrange("queue:jobs", 0, -1)]
    assert job_id in queued_ids


async def test_get_job_returns_404_for_unknown_id(client):
    response = await client.get("/jobs/does-not-exist")
    assert response.status_code == 404


async def test_worker_completion_flow(client, internal_headers):
    create_resp = await client.post("/jobs", json={"video_url": "https://example.com/lecture2.mp4"})
    job_id = create_resp.json()["id"]
    assert create_resp.json()["status"] == "queued"

    complete_resp = await client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": "Shalom, this is a transcript.", "srt": "1\n00:00:00,000 --> 00:00:02,000\nShalom\n", "language": "he"},
        headers=internal_headers,
    )
    assert complete_resp.status_code == 200

    status_resp = await client.get(f"/jobs/{job_id}")
    assert status_resp.json()["status"] == "completed"
    assert status_resp.json()["text"] == "Shalom, this is a transcript."

    txt_resp = await client.get(f"/jobs/{job_id}/txt")
    assert txt_resp.text == "Shalom, this is a transcript."

    srt_resp = await client.get(f"/jobs/{job_id}/srt")
    assert "Shalom" in srt_resp.text


async def test_recent_jobs_lists_provider(client, internal_headers):
    create = await client.post("/jobs", json={"video_url": "https://example.com/recent.mp4"})
    job_id = create.json()["id"]
    await client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": "t", "srt": "s", "language": "he"},
        headers=internal_headers,
    )

    resp = await client.get("/jobs/recent?limit=5")
    assert resp.status_code == 200
    rows = resp.json()
    # the job we just completed via the worker endpoint shows provider "cluster"
    assert any(r["id"] == job_id and r["provider"] == "cluster" for r in rows)


async def test_internal_endpoint_rejects_bad_token(client):
    create_resp = await client.post("/jobs", json={"video_url": "https://example.com/lecture3.mp4"})
    job_id = create_resp.json()["id"]

    resp = await client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": "x", "srt": "x", "language": "he"},
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 401


async def test_cache_purge_removes_transcript_for_vip(client, internal_headers, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "unlimited_user_ids", {"moodle:vip"})
    # Every test's fake audio hashes the same, so pin a unique hash to avoid being served a
    # different test's cached transcript out of the shared DB.
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _path: "purge-hash-xyz")

    # Seed a cached lecture: a job with a moodle_video_id records the id->hash mapping, and
    # completing it via the worker endpoint stores the transcript.
    create = await client.post(
        "/jobs", json={"video_url": "https://example.com/p.mp4", "moodle_video_id": "vid-purge"}
    )
    job_id = create.json()["id"]
    await client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": "to be purged", "srt": "s", "language": "he"},
        headers=internal_headers,
    )
    assert (await client.get(f"/jobs/{job_id}/txt")).text == "to be purged"

    # A non-allowlisted user can't purge.
    forbidden = await client.post(
        "/cache/purge", json={"user_id": "moodle:nobody", "moodle_video_ids": ["vid-purge"]}
    )
    assert forbidden.status_code == 403
    assert (await client.get(f"/jobs/{job_id}/txt")).text == "to be purged"  # still cached

    # A VIP purges it.
    resp = await client.post(
        "/cache/purge", json={"user_id": "moodle:vip", "moodle_video_ids": ["vid-purge"]}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_transcripts"] == 1
    assert body["deleted_mappings"] == 1
    assert body["requested_ids"] == 1

    # The transcript is gone, so the lecture would transcribe fresh next time.
    assert (await client.get(f"/jobs/{job_id}/txt")).status_code == 409


async def test_duplicate_audio_hash_is_served_from_cache(client, internal_headers, monkeypatch):
    monkeypatch.setattr(audio_extract, "hash_audio", lambda path: "shared-hash-123")

    first = await client.post("/jobs", json={"video_url": "https://example.com/a.mp4"})
    first_id = first.json()["id"]
    await client.post(
        f"/internal/jobs/{first_id}/complete",
        json={"text": "cached transcript text", "srt": "srt-content", "language": "he"},
        headers=internal_headers,
    )

    second = await client.post("/jobs", json={"video_url": "https://example.com/b.mp4"})
    body = second.json()
    assert body["status"] == "completed"
    assert body["text"] == "cached transcript text"

    from fakeredis.aioredis import FakeRedis

    redis = FakeRedis.from_url("redis://localhost:6379/0")
    queued_ids = [item.decode() for item in await redis.lrange("queue:jobs", 0, -1)]
    assert second.json()["id"] not in queued_ids
