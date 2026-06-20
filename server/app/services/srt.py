import re

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
