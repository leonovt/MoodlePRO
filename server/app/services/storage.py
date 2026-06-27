import asyncio
import logging
import shutil
import time
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)


def job_dir(job_id: str) -> Path:
    return Path(settings.storage_dir) / job_id


def video_path(job_id: str) -> Path:
    return job_dir(job_id) / "source.mp4"


def audio_path(job_id: str) -> Path:
    return job_dir(job_id) / "audio.wav"


def audio_opus_path(job_id: str) -> Path:
    """Compressed copy served to the GPU worker; the WAV stays canonical for hashing/Groq."""
    return job_dir(job_id) / "audio.opus"


def cleanup_job(job_id: str) -> None:
    """Delete a job's downloaded video + extracted audio once its transcript is persisted.

    The transcript lives in the DB/dedup cache (re-watches hit the cache, and summaries/
    quizzes work off the text), so these large files — a multi-hundred-MB video plus a
    ~200MB WAV per lecture — are dead weight afterwards. Without this they pile up and fill
    the small Oracle Always-Free disk ('No space left on device')."""
    shutil.rmtree(job_dir(job_id), ignore_errors=True)


def _dir_last_touch(d: Path) -> float:
    """Most recent mtime among a job dir and its files. Job files (source.mp4, audio.wav,
    audio.opus) are written flat, so a shallow scan is enough to tell when the job last
    made progress."""
    times = [d.stat().st_mtime]
    for child in d.iterdir():
        try:
            times.append(child.stat().st_mtime)
        except OSError:
            pass
    return max(times)


def sweep_orphaned_job_dirs(max_age_seconds: float) -> int:
    """Delete job dirs untouched for longer than max_age_seconds — the safety net for jobs
    that died without any cleanup callback (worker crash / SLURM eviction). cleanup_job
    handles every normal terminal path; this only catches the abandoned ones so they can't
    fill the disk permanently. Returns the number of dirs removed."""
    root = Path(settings.storage_dir)
    if not root.exists():
        return 0
    cutoff = time.time() - max_age_seconds
    removed = 0
    for child in root.iterdir():
        if not child.is_dir():
            continue
        try:
            if _dir_last_touch(child) < cutoff:
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return removed


async def sweep_job_dirs_forever() -> None:
    """Run sweep_orphaned_job_dirs on a fixed interval for the life of the server."""
    while True:
        await asyncio.sleep(settings.job_dir_sweep_interval_seconds)
        try:
            removed = await asyncio.to_thread(
                sweep_orphaned_job_dirs, settings.job_dir_max_age_hours * 3600
            )
            if removed:
                logger.info("janitor: removed %d orphaned job dir(s)", removed)
        except Exception:  # noqa: BLE001 - background task; never let the janitor crash the loop
            logger.exception("janitor sweep failed")
