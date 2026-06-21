import shutil
from pathlib import Path

from app.core.config import settings


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
