import wave

from transcriber import FakeTranscriber, Segment, build_srt


def _write_silent_wav(path, seconds: float, framerate: int = 16000) -> None:
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(framerate)
        f.writeframes(b"\x00\x00" * int(seconds * framerate))


def test_fake_transcriber_yields_sequential_non_overlapping_segments(tmp_path):
    audio_path = tmp_path / "audio.wav"
    _write_silent_wav(audio_path, seconds=7.5)

    segments = list(FakeTranscriber().transcribe(audio_path))
    assert len(segments) == 3
    for prev, nxt in zip(segments, segments[1:]):
        assert prev.end == nxt.start
    assert all(seg.text for seg in segments)


def test_fake_transcriber_loops_sample_lines_to_cover_full_duration(tmp_path):
    audio_path = tmp_path / "audio.wav"
    _write_silent_wav(audio_path, seconds=20.0)

    segments = list(FakeTranscriber().transcribe(audio_path))
    assert len(segments) == 8  # 20s / 2.5s per segment
    assert segments[0].text == segments[3].text  # sample lines repeat (looped)
    assert segments[-1].end == 20.0


def test_fake_transcriber_falls_back_to_default_length_without_a_readable_wav(tmp_path):
    audio_path = tmp_path / "not-a-wav.bin"
    audio_path.write_bytes(b"not a real wav file")

    segments = list(FakeTranscriber().transcribe(audio_path))
    assert len(segments) == 3


def test_build_srt_formats_timestamps_and_text():
    segments = [Segment(text="hello", start=0.0, end=1.5), Segment(text="world", start=1.5, end=3.0)]
    srt = build_srt(segments)
    assert "1\n00:00:00,000 --> 00:00:01,500\nhello" in srt
    assert "2\n00:00:01,500 --> 00:00:03,000\nworld" in srt
