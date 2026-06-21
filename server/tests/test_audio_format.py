from pathlib import Path

from app.api import internal as api_internal
from app.services import storage


async def test_audio_opus_is_transcoded_once_and_served(client, internal_headers, monkeypatch):
    """format=opus serves a compressed copy: it's transcoded from the WAV on first request
    (then reused) and the WAV stays untouched as the canonical file."""
    job_id = "job-opus"
    wav = storage.audio_path(job_id)
    wav.parent.mkdir(parents=True, exist_ok=True)
    wav.write_bytes(b"RIFF....fake-wav")

    calls = {"n": 0}

    def fake_compress(wav_path: Path, dest_path: Path, bitrate: str = "32k") -> Path:
        calls["n"] += 1
        dest_path.write_bytes(b"OggS-fake-opus")
        return dest_path

    monkeypatch.setattr(api_internal.audio_extract, "compress_to_opus", fake_compress)

    first = await client.get(
        f"/internal/audio/{job_id}", params={"format": "opus"}, headers=internal_headers
    )
    assert first.status_code == 200
    assert first.content == b"OggS-fake-opus"
    assert calls["n"] == 1

    # Second request reuses the cached opus file — no re-transcode.
    second = await client.get(
        f"/internal/audio/{job_id}", params={"format": "opus"}, headers=internal_headers
    )
    assert second.status_code == 200
    assert calls["n"] == 1


async def test_audio_defaults_to_wav(client, internal_headers, monkeypatch):
    job_id = "job-wav"
    wav = storage.audio_path(job_id)
    wav.parent.mkdir(parents=True, exist_ok=True)
    wav.write_bytes(b"RIFF....canonical")

    # If anything tried to transcode for the default request, fail loudly.
    def boom(*args, **kwargs):
        raise AssertionError("wav request must not transcode")

    monkeypatch.setattr(api_internal.audio_extract, "compress_to_opus", boom)

    resp = await client.get(f"/internal/audio/{job_id}", headers=internal_headers)
    assert resp.status_code == 200
    assert resp.content == b"RIFF....canonical"


async def test_audio_404_when_missing(client, internal_headers):
    resp = await client.get(
        "/internal/audio/nope", params={"format": "opus"}, headers=internal_headers
    )
    assert resp.status_code == 404
