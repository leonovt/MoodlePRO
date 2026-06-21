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


def compress_to_opus(wav_path: Path, dest_path: Path, bitrate: str = "32k") -> Path:
    """Re-encode the 16kHz mono WAV to Opus for transfer to the GPU worker.

    A 2h lecture is ~200 MB as PCM WAV but ~15 MB as 32 kbps Opus, so the worker's audio
    fetch (the dominant cost on long lectures) shrinks ~13x. 32 kbps is effectively
    transparent for speech recognition. The WAV remains the canonical file for the dedup
    hash and the Groq upload path."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(wav_path),
            "-c:a", "libopus",
            "-b:a", bitrate,
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
