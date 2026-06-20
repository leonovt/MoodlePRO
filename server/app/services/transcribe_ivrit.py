from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

import httpx

from app.core.config import settings
from app.services.srt import Segment, build_srt
from app.services.transcribe_groq import (
    TranscriptionProvider,
    TranscriptionResult,
    _offset_segments,
    _split_audio,
)

logger = logging.getLogger(__name__)


class IvritServerlessTranscriber(TranscriptionProvider):
    """Self-hosted ivrit-ai (Hebrew-finetuned Whisper) on a serverless GPU endpoint
    (Modal / RunPod — see serverless/). Same TranscriptionProvider contract as Groq, so
    it's a drop-in alternative selected by settings.fallback_provider.

    Endpoint contract: POST multipart {file, language} with `Authorization: Bearer <token>`,
    returns JSON {"text": str, "segments": [{"text","start","end"}], "language": str}.
    Unlike Groq there is no hard upload cap, but very large bodies are chunked anyway to
    keep requests modest and reuse the same offset/stitch logic.
    """

    def __init__(
        self,
        endpoint_url: str | None = None,
        api_token: str | None = None,
        max_upload_mb: float | None = None,
        chunk_seconds: float | None = None,
    ) -> None:
        self._endpoint_url = (endpoint_url or settings.ivrit_endpoint_url).rstrip("/")
        self._api_token = api_token if api_token is not None else settings.ivrit_api_token
        self._max_upload_bytes = int(
            (max_upload_mb if max_upload_mb is not None else settings.ivrit_max_upload_mb)
            * 1024 * 1024
        )
        self._chunk_seconds = (
            chunk_seconds if chunk_seconds is not None else settings.groq_chunk_seconds
        )
        if not self._endpoint_url:
            raise RuntimeError("IVRIT_ENDPOINT_URL is not configured")

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_token}"} if self._api_token else {}

    async def _transcribe_file(self, audio_path: Path, language: str) -> tuple[list[Segment], str]:
        with audio_path.open("rb") as audio_file:
            files = {"file": (audio_path.name, audio_file, "application/octet-stream")}
            data = {"language": language}
            async with httpx.AsyncClient(timeout=httpx.Timeout(900.0)) as http_client:
                response = await http_client.post(
                    self._endpoint_url, headers=self._headers(), data=data, files=files
                )
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
            "ivrit: audio is %.1f MB (> %.1f MB); chunking into %.0fs pieces",
            size / 1024 / 1024,
            self._max_upload_bytes / 1024 / 1024,
            self._chunk_seconds,
        )
        with tempfile.TemporaryDirectory(prefix="ivrit-chunks-") as tmp:
            chunks = await asyncio.to_thread(
                _split_audio, audio_path, self._chunk_seconds, Path(tmp)
            )
            all_segments: list[Segment] = []
            for offset, chunk_path in chunks:
                segments, _ = await self._transcribe_file(chunk_path, language)
                all_segments.extend(_offset_segments(segments, offset))

        text = " ".join(s.text for s in all_segments)
        return TranscriptionResult(text=text, srt=build_srt(all_segments), language=language)
