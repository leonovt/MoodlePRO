import wave
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
    _SEGMENT_SECONDS = 2.5

    def transcribe(self, audio_path: Path) -> Iterator[Segment]:
        duration = self._audio_duration(audio_path)
        t = 0.0
        i = 0
        # Float accumulation of _SEGMENT_SECONDS can leave t a hair under an exact
        # multiple of duration; without the epsilon that produces a trailing
        # zero-duration segment (e.g. "15,000 --> 15,000").
        while duration - t > 1e-6:
            line = self._SAMPLE_LINES[i % len(self._SAMPLE_LINES)]
            end = min(t + self._SEGMENT_SECONDS, duration)
            yield Segment(text=line, start=t, end=end)
            t = end
            i += 1

    @staticmethod
    def _audio_duration(audio_path: Path) -> float:
        # The server always hands the worker a PCM .wav (ffmpeg -ar 16000 -ac 1),
        # so the wave module can read its length without any extra dependency.
        try:
            with wave.open(str(audio_path), "rb") as f:
                return f.getnframes() / f.getframerate()
        except (wave.Error, EOFError, OSError):
            return len(FakeTranscriber._SAMPLE_LINES) * FakeTranscriber._SEGMENT_SECONDS


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
