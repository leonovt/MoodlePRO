from __future__ import annotations

import asyncio
import logging
import subprocess
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.core.config import settings
from app.services.srt import Segment, build_srt

logger = logging.getLogger(__name__)


@dataclass
class TranscriptionResult:
    text: str
    srt: str
    language: str


class TranscriptionProvider(ABC):
    """Cloud transcription fallback, used when no cluster GPU worker claims a queued
    job within the grace period (see app.services.fallback)."""

    @abstractmethod
    async def transcribe(self, audio_path: Path, language: str) -> TranscriptionResult:
        ...


def _audio_duration_seconds(audio_path: Path) -> float:
    """Total duration of an audio file in seconds, via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def _split_audio(audio_path: Path, chunk_seconds: float, dest_dir: Path) -> list[tuple[float, Path]]:
    """Slice audio into <= chunk_seconds FLAC pieces. Returns (start_offset, path) pairs.

    FLAC keeps each chunk losslessly small (well under Groq's upload limit) while
    preserving ASR quality. Slicing PCM/WAV with -ss before -i is accurate, so the
    offset of chunk i is simply i * chunk_seconds.
    """
    duration = _audio_duration_seconds(audio_path)
    chunks: list[tuple[float, Path]] = []
    index = 0
    start = 0.0
    while start < duration:
        dest = dest_dir / f"chunk_{index:04d}.flac"
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-t", str(chunk_seconds),
                "-i", str(audio_path),
                "-ar", "16000",
                "-ac", "1",
                "-c:a", "flac",
                str(dest),
            ],
            check=True,
            capture_output=True,
        )
        chunks.append((start, dest))
        start += chunk_seconds
        index += 1
    return chunks


def _offset_segments(segments: list[Segment], offset: float) -> list[Segment]:
    """Shift every segment's timestamps by offset seconds (to place a chunk on the
    original audio's timeline)."""
    return [Segment(text=s.text, start=s.start + offset, end=s.end + offset) for s in segments]


class GroqTranscriber(TranscriptionProvider):
    """Groq whisper-large-v3 via the OpenAI-compatible /audio/transcriptions endpoint.

    Files larger than groq_max_upload_mb are split into groq_chunk_seconds pieces and
    transcribed sequentially, since Groq rejects oversized uploads (a 2h lecture as WAV
    is far over the limit)."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        max_upload_mb: float | None = None,
        chunk_seconds: float | None = None,
        max_retries: int | None = None,
    ) -> None:
        self._api_key = api_key or settings.groq_api_key
        self._model = model or settings.groq_model
        self._base_url = (base_url or settings.groq_base_url).rstrip("/")
        self._max_upload_bytes = int(
            (max_upload_mb if max_upload_mb is not None else settings.groq_max_upload_mb)
            * 1024 * 1024
        )
        self._chunk_seconds = (
            chunk_seconds if chunk_seconds is not None else settings.groq_chunk_seconds
        )
        self._max_retries = max_retries if max_retries is not None else settings.groq_max_retries
        if not self._api_key:
            raise RuntimeError("GROQ_API_KEY is not configured")

    def _retry_delay(self, response: httpx.Response, attempt: int) -> float:
        """Seconds to wait before retrying a 429: the Retry-After header if Groq sent one,
        otherwise exponential backoff. Capped at groq_retry_max_seconds."""
        retry_after = response.headers.get("retry-after")
        if retry_after:
            try:
                return min(float(retry_after), settings.groq_retry_max_seconds)
            except ValueError:
                pass
        return min(settings.groq_retry_base_seconds * (2 ** attempt), settings.groq_retry_max_seconds)

    async def _transcribe_file(self, audio_path: Path, language: str) -> tuple[list[Segment], str]:
        """POST a single (already small enough) audio file. Returns its segments and the
        provider's full-text field. Retries on HTTP 429 with backoff."""
        data = {
            "model": self._model,
            "language": language,
            "response_format": "verbose_json",
        }
        with audio_path.open("rb") as audio_file:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600.0)) as http_client:
                for attempt in range(self._max_retries + 1):
                    audio_file.seek(0)  # rewind so each retry re-uploads the whole file
                    files = {"file": (audio_path.name, audio_file, "application/octet-stream")}
                    response = await http_client.post(
                        f"{self._base_url}/audio/transcriptions",
                        headers={"Authorization": f"Bearer {self._api_key}"},
                        data=data,
                        files=files,
                    )
                    if response.status_code == 429 and attempt < self._max_retries:
                        delay = self._retry_delay(response, attempt)
                        logger.warning(
                            "groq rate-limited (429); retrying in %.1fs (attempt %d/%d)",
                            delay, attempt + 1, self._max_retries,
                        )
                        await asyncio.sleep(delay)
                        continue
                    break
        response.raise_for_status()
        body = response.json()

        segments = [
            Segment(
                text=str(seg.get("text", "")).strip(),
                start=float(seg.get("start", 0.0)),
                end=float(seg.get("end", 0.0)),
            )
            for seg in body.get("segments", [])
        ]
        text = str(body.get("text", "")).strip()
        return segments, text

    async def transcribe(self, audio_path: Path, language: str) -> TranscriptionResult:
        size = audio_path.stat().st_size
        if size <= self._max_upload_bytes:
            segments, text = await self._transcribe_file(audio_path, language)
            text = text or " ".join(s.text for s in segments)
            return TranscriptionResult(text=text, srt=build_srt(segments), language=language)

        logger.info(
            "groq: audio is %.1f MB (> %.1f MB limit); chunking into %.0fs pieces",
            size / 1024 / 1024,
            self._max_upload_bytes / 1024 / 1024,
            self._chunk_seconds,
        )
        with tempfile.TemporaryDirectory(prefix="groq-chunks-") as tmp:
            chunks = await asyncio.to_thread(
                _split_audio, audio_path, self._chunk_seconds, Path(tmp)
            )
            all_segments: list[Segment] = []
            for offset, chunk_path in chunks:
                segments, _ = await self._transcribe_file(chunk_path, language)
                all_segments.extend(_offset_segments(segments, offset))

        text = " ".join(s.text for s in all_segments)
        return TranscriptionResult(text=text, srt=build_srt(all_segments), language=language)
