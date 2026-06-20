"""Live smoke test for the Groq transcription fallback.

Hits the REAL Groq API to verify our request/response mapping, which the unit tests
mock. Reads the key from the GROQ_API_KEY environment variable — never hardcode it.

Usage (from server/, with the venv and GROQ_API_KEY exported):
    python scripts/smoke_groq.py [path/to/audio.wav]

With no argument it uses a short generated tone, which verifies the plumbing and the
verbose_json -> TranscriptionResult mapping (the text will likely be empty). For a
meaningful Hebrew transcription, pass a real lecture clip.
"""
from __future__ import annotations

import asyncio
import math
import struct
import sys
import tempfile
import wave
from pathlib import Path

# Hebrew transcripts must print on a Windows (cp1252) console too.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.services.transcribe_groq import GroqTranscriber  # noqa: E402


def _make_tone_wav(path: Path, seconds: float = 3.0, freq: float = 440.0, rate: int = 16000) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(seconds * rate)):
            sample = int(3000 * math.sin(2 * math.pi * freq * i / rate))
            frames += struct.pack("<h", sample)
        w.writeframes(bytes(frames))


async def main() -> int:
    if not settings.groq_api_key:
        print("ERROR: GROQ_API_KEY not set in the environment.", file=sys.stderr)
        return 1

    if len(sys.argv) > 1:
        audio_path = Path(sys.argv[1])
        if not audio_path.exists():
            print(f"ERROR: audio file not found: {audio_path}", file=sys.stderr)
            return 1
    else:
        audio_path = Path(tempfile.mkdtemp()) / "tone.wav"
        _make_tone_wav(audio_path)
        print(f"No audio given; using generated tone at {audio_path}")

    print(f"model={settings.groq_model}  base_url={settings.groq_base_url}")
    print(f"transcribing {audio_path} ({audio_path.stat().st_size} bytes) ...")

    result = await GroqTranscriber().transcribe(audio_path, language="he")

    print("\n--- RESULT ---")
    print(f"language: {result.language}")
    print(f"text: {result.text!r}")
    srt_lines = result.srt.splitlines()
    print(f"srt: {len(srt_lines)} lines; first block:")
    print("\n".join(srt_lines[:4]) if srt_lines else "(empty)")
    print("\nOK: live Groq call succeeded and mapped to TranscriptionResult.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
