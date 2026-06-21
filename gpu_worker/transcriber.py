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


def resolve_language(language: str | None) -> str | None:
    """Map the worker's configured language to faster-whisper's `language` arg.

    "auto" or empty means autodetect (None). Forcing a fixed language makes Whisper emit
    that language's tokens for ANY audio — e.g. an English lecture transcribed under a
    hard-coded "he" comes out as garbled Hebrew. Autodetect handles Hebrew, English, and
    mixed lectures correctly."""
    if not language or language.lower() == "auto":
        return None
    return language


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


def select_model_key(language: str | None, has_secondary: bool) -> str:
    """Pick which loaded model transcribes audio of the given (forced or detected) language.

    The primary model is Hebrew-finetuned (ivrit-ai): great for Hebrew, but it mis-detects
    and under-transcribes English. So Hebrew — or anything, when no secondary is loaded —
    goes to 'primary'; any other language goes to the stock multilingual 'secondary'."""
    if not has_secondary:
        return "primary"
    return "primary" if language == "he" else "secondary"


class _LoadedModel:
    """One faster-whisper model plus its optional batched pipeline."""

    def __init__(self, model, batch_size: int):
        self.model = model
        self.batch_size = batch_size
        try:
            from faster_whisper import BatchedInferencePipeline

            self.batched = BatchedInferencePipeline(model=model)
        except Exception:  # noqa: BLE001 - older faster-whisper: fall back to sequential
            self.batched = None

    def transcribe(self, audio_path: Path, language: str | None) -> Iterator[Segment]:
        if self.batched is not None and self.batch_size > 1:
            segments, _info = self.batched.transcribe(
                str(audio_path), language=language, batch_size=self.batch_size, vad_filter=True
            )
        else:
            segments, _info = self.model.transcribe(
                str(audio_path), language=language, vad_filter=True
            )
        for seg in segments:
            yield Segment(text=seg.text.strip(), start=seg.start, end=seg.end)

    def detect_language(self, audio_path: Path) -> str | None:
        """Detect the spoken language cheaply. faster-whisper detects eagerly inside
        transcribe() (before the returned segment generator is iterated), so reading
        info.language without consuming the generator runs detection but NOT a full decode."""
        _segments, info = self.model.transcribe(str(audio_path), vad_filter=True)
        return getattr(info, "language", None)


class WhisperTranscriber(Transcriber):
    """Real faster-whisper pipeline. Requires CUDA and the faster-whisper package.

    Loads the Hebrew-finetuned ivrit-ai model and, optionally, a stock multilingual model.
    With both loaded, it detects the language using the stock model (the ivrit one is biased
    toward Hebrew) and routes Hebrew to ivrit, everything else to the stock model — so an
    English lecture is no longer transcribed as garbled Hebrew. Uses the batched inference
    pipeline (2-4x faster) with VAD filtering, falling back to sequential on old versions."""

    def __init__(
        self,
        model_name: str,
        device: str,
        compute_type: str,
        language: str,
        batch_size: int = 16,
        english_model_name: str | None = None,
    ):
        from faster_whisper import WhisperModel  # local import: heavy, GPU-only dependency

        self._language = language
        self.detected_language: str | None = None
        self._primary = _LoadedModel(
            WhisperModel(model_name, device=device, compute_type=compute_type), batch_size
        )
        self._secondary: _LoadedModel | None = None
        if english_model_name:
            self._secondary = _LoadedModel(
                WhisperModel(english_model_name, device=device, compute_type=compute_type),
                batch_size,
            )

    def transcribe(self, audio_path: Path) -> Iterator[Segment]:
        forced = resolve_language(self._language)
        if self._secondary is None:
            # Single-model mode: let the model autodetect (or honor a pinned language).
            language = forced
            if language is None:
                language = self._primary.detect_language(audio_path)
            self.detected_language = language
            yield from self._primary.transcribe(audio_path, language)
            return

        # Dual-model: detect with the stock model (neutral, unbiased), then route.
        language = forced if forced is not None else self._secondary.detect_language(audio_path)
        self.detected_language = language
        chosen = self._primary if select_model_key(language, True) == "primary" else self._secondary
        yield from chosen.transcribe(audio_path, language)


def get_transcriber(settings: WorkerSettings) -> Transcriber:
    if settings.fake_transcribe:
        return FakeTranscriber()
    return WhisperTranscriber(
        settings.model_name, settings.device, settings.compute_type, settings.language,
        settings.batch_size, settings.english_model_name or None,
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
