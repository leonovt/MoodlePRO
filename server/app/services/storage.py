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
