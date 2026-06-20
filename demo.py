"""Runs the full create-job -> queue -> (stub) transcribe -> stream -> store pipeline
in-process, with no Docker/Postgres/Redis/ffmpeg required, so you can see exactly what
the stub produces and how the pieces talk to each other.

Uses the same SQLite + fakeredis substitution the test suites use (see
server/tests/conftest.py and gpu_worker/tests/conftest.py) — this is a manual,
narrated version of gpu_worker/tests/test_integration.py.

Run from the repo root:

    cd server && pip install -r requirements-dev.txt
    cd ../gpu_worker && pip install -r requirements-dev.txt
    cd .. && python demo.py [duration_seconds]
"""

import asyncio
import os
import sys
import tempfile
import wave
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

_REPO_ROOT = Path(__file__).resolve().parent
_tmp_dir = tempfile.mkdtemp(prefix="moodlepro-demo-")

# Must be set before importing app.core.config / config (pydantic-settings reads env at import time).
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp_dir}/demo.db"
os.environ["STORAGE_DIR"] = str(Path(_tmp_dir) / "storage")
os.environ["INTERNAL_API_TOKEN"] = "demo-token"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"

sys.path.insert(0, str(_REPO_ROOT / "server"))
sys.path.insert(0, str(_REPO_ROOT / "gpu_worker"))

import fakeredis.aioredis as fakeredis_aio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app import main as app_main  # noqa: E402
from app.api import internal as api_internal  # noqa: E402
from app.api import jobs as api_jobs  # noqa: E402
from app.main import app  # noqa: E402
from app.services import audio_extract, video_fetch  # noqa: E402

from config import WorkerSettings  # noqa: E402
from transcriber import FakeTranscriber  # noqa: E402
from worker import run_once  # noqa: E402


def _write_silent_wav(path: Path, seconds: float, framerate: int = 16000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(framerate)
        f.writeframes(b"\x00\x00" * int(seconds * framerate))


async def main(duration: float) -> None:
    api_jobs.Redis = fakeredis_aio.FakeRedis
    api_internal.Redis = fakeredis_aio.FakeRedis
    app_main.Redis = fakeredis_aio.FakeRedis
    fake_redis = fakeredis_aio.FakeRedis.from_url(os.environ["REDIS_URL"])

    async def fake_download(video_url: str, dest_dir: Path) -> Path:
        # Stands in for the real yt-dlp/HTTP download in server/app/services/video_fetch.py.
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = dest_dir / "source.mp4"
        path.write_bytes(b"fake video bytes")
        return path

    def fake_extract(video_path: Path, dest_path: Path) -> Path:
        # Stands in for the real ffmpeg extraction in server/app/services/audio_extract.py
        # — writes a real silent WAV of the requested length so FakeTranscriber's
        # duration-based looping has something real to measure.
        _write_silent_wav(dest_path, seconds=duration)
        return dest_path

    video_fetch.download_video = fake_download
    audio_extract.extract_audio = fake_extract

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://demo-server") as server_client:
            print(f"--- 1. Extension POSTs /jobs (simulated {duration:.1f}s lecture video) ---")
            create_resp = await server_client.post(
                "/jobs", json={"video_url": "https://example.com/lecture.mp4"}
            )
            job = create_resp.json()
            print(f"    -> job {job['id']} status={job['status']}\n")

            print("--- 2. Extension opens WS /ws/jobs/{id} and starts listening ---")
            print("    (here we just subscribe to the same Redis pub/sub channel the WS relays)\n")

            print("--- 3. GPU worker pops the job, fetches audio, runs FakeTranscriber ---")
            worker_settings = WorkerSettings(internal_api_token="demo-token")
            await run_once(fake_redis, server_client, FakeTranscriber(), worker_settings, poll_timeout=1)

            print("--- 4. Final transcript + SRT, exactly as /jobs/{id}/txt and /srt return them ---\n")
            status_resp = await server_client.get(f"/jobs/{job['id']}")
            body = status_resp.json()
            print(f"    status: {body['status']}")
            print(f"    text:   {body['text']}\n")

            srt_resp = await server_client.get(f"/jobs/{job['id']}/srt")
            print("    --- srt ---")
            print(srt_resp.text)


if __name__ == "__main__":
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 18.0
    asyncio.run(main(seconds))
