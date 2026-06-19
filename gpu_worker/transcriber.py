from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from config import WorkerSettings


@dataclass
class Segment:
    text: str
    start: float
    end: float


class Transcriber:
    def transcribe(self, audio_path: Path) -> Iterator[Segment]:
        raise NotImplementedError


class FakeTranscriber(Transcriber):
    """Deterministic stand-in used until a real GPU + ivrit-ai model is wired up.

    Lets the rest of the pipeline (queueing, streaming, storage, dedup) be built
    and tested without CUDA or the ivrit-ai model installed.
    """

    _SAMPLE_LINES = [
        "שלום וברוכים הבאים להרצאה",
        "היום נדבר על מערכות מבוזרות",
        "תודה רבה ולהתראות",
    ]

    def transcribe(self, audio_path: Path) -> Iterator[Segment]:
        t = 0.0
        for line in self._SAMPLE_LINES:
            start, end = t, t + 2.5
            yield Segment(text=line, start=start, end=end)
            t = end


class WhisperTranscriber(Transcriber):
    """Real faster-whisper + ivrit-ai pipeline. Requires CUDA and the faster-whisper package."""

    def __init__(self, model_name: str, device: str, compute_type: str, language: str):
        from faster_whisper import WhisperModel  # local import: heavy, GPU-only dependency

        self._model = WhisperModel(model_name, device=device, compute_type=compute_type)
        self._language = language

    def transcribe(self, audio_path: Path) -> Iterator[Segment]:
        segments, _info = self._model.transcribe(str(audio_path), language=self._language)
        for seg in segments:
            yield Segment(text=seg.text.strip(), start=seg.start, end=seg.end)


def get_transcriber(settings: WorkerSettings) -> Transcriber:
    if settings.fake_transcribe:
        return FakeTranscriber()
    return WhisperTranscriber(
        settings.model_name, settings.device, settings.compute_type, settings.language
    )


def build_srt(segments: list[Segment]) -> str:
    def _timestamp(seconds: float) -> str:
        millis = int(round(seconds * 1000))
        hours, millis = divmod(millis, 3_600_000)
        minutes, millis = divmod(millis, 60_000)
        secs, millis = divmod(millis, 1_000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    lines = []
    for i, seg in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_timestamp(seg.start)} --> {_timestamp(seg.end)}")
        lines.append(seg.text)
        lines.append("")
    return "\n".join(lines)
