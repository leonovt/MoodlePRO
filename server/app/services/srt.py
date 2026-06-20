import re
from dataclasses import dataclass

_TIMESTAMP_RE = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)")


def _parse_timestamp(ts: str) -> float:
    match = _TIMESTAMP_RE.search(ts)
    if not match:
        return 0.0
    hours, minutes, seconds, millis = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_srt(srt_text: str) -> list[dict]:
    """Parses standard .srt text into `{start, end, text}` segments, in seconds."""
    if not srt_text:
        return []

    segments = []
    for block in srt_text.replace("\r", "").strip().split("\n\n"):
        lines = [line for line in block.split("\n") if line]
        time_line_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if time_line_index is None:
            continue

        start_str, end_str = lines[time_line_index].split("-->")
        text = " ".join(lines[time_line_index + 1 :]).strip()
        if not text:
            continue

        segments.append(
            {"start": _parse_timestamp(start_str), "end": _parse_timestamp(end_str), "text": text}
        )
    return segments


@dataclass
class Segment:
    text: str
    start: float
    end: float


def _timestamp(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def build_srt(segments: list[Segment]) -> str:
    """Render SRT subtitle text. Mirrors the gpu_worker's builder so cluster- and
    Groq-produced transcripts share an identical wire format."""
    lines: list[str] = []
    for i, seg in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_timestamp(seg.start)} --> {_timestamp(seg.end)}")
        lines.append(seg.text)
        lines.append("")
    return "\n".join(lines)
