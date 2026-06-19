import hashlib
import subprocess
from pathlib import Path


def extract_audio(video_path: Path, dest_path: Path) -> Path:
    """Extracts 16kHz mono audio from a video file using ffmpeg."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-ar", "16000",
            "-ac", "1",
            "-vn",
            str(dest_path),
        ],
        check=True,
        capture_output=True,
    )
    return dest_path


def hash_audio(audio_path: Path) -> str:
    """SHA-256 hash of the raw audio bytes, used as the dedup key."""
    digest = hashlib.sha256()
    with audio_path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()
