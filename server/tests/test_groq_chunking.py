from pathlib import Path

import app.services.transcribe_groq as tg
from app.services.srt import Segment


def test_offset_segments_shifts_timestamps():
    segments = [Segment(text="a", start=0.0, end=2.0), Segment(text="b", start=2.0, end=4.0)]
    shifted = tg._offset_segments(segments, 600.0)
    assert [(s.start, s.end) for s in shifted] == [(600.0, 602.0), (602.0, 604.0)]
    assert [s.text for s in shifted] == ["a", "b"]  # text untouched


async def test_small_file_is_single_request(monkeypatch, tmp_path):
    audio = tmp_path / "small.wav"
    audio.write_bytes(b"x" * 1024)

    calls: list[Path] = []

    async def fake_one(self, path, language):
        calls.append(path)
        return [Segment(text="hello", start=0.0, end=1.0)], "hello"

    def fake_split(*args, **kwargs):  # must NOT be called for a small file
        raise AssertionError("small file should not be chunked")

    monkeypatch.setattr(tg.GroqTranscriber, "_transcribe_file", fake_one)
    monkeypatch.setattr(tg, "_split_audio", fake_split)

    tr = tg.GroqTranscriber(api_key="k", max_upload_mb=1.0)  # 1 MB limit; file is 1 KB
    result = await tr.transcribe(audio, "he")

    assert calls == [audio]  # the original file, sent once
    assert result.text == "hello"


async def test_large_file_is_chunked_and_stitched(monkeypatch, tmp_path):
    audio = tmp_path / "big.wav"
    audio.write_bytes(b"x" * 4096)

    # Three 10-minute chunks at offsets 0, 600, 1200.
    def fake_split(path, chunk_seconds, dest_dir):
        return [(0.0, dest_dir / "c0"), (600.0, dest_dir / "c1"), (1200.0, dest_dir / "c2")]

    async def fake_one(self, path, language):
        # one segment per chunk, local time 0..2, text tagged by chunk file name
        return [Segment(text=f"seg-{path.name}", start=0.0, end=2.0)], ""

    monkeypatch.setattr(tg, "_split_audio", fake_split)
    monkeypatch.setattr(tg.GroqTranscriber, "_transcribe_file", fake_one)

    tr = tg.GroqTranscriber(api_key="k", max_upload_mb=0.000001, chunk_seconds=600.0)
    result = await tr.transcribe(audio, "he")

    # all three chunks stitched, in order
    assert result.text == "seg-c0 seg-c1 seg-c2"
    # timestamps offset onto the original timeline: 600s -> 00:10:00, 1200s -> 00:20:00
    assert "00:10:00,000 --> 00:10:02,000" in result.srt
    assert "00:20:00,000 --> 00:20:02,000" in result.srt
    assert result.language == "he"
