from transcriber import FakeTranscriber, Segment, build_srt


def test_fake_transcriber_yields_sequential_non_overlapping_segments():
    segments = list(FakeTranscriber().transcribe(audio_path=None))
    assert len(segments) == 3
    for prev, nxt in zip(segments, segments[1:]):
        assert prev.end == nxt.start
    assert all(seg.text for seg in segments)


def test_build_srt_formats_timestamps_and_text():
    segments = [Segment(text="hello", start=0.0, end=1.5), Segment(text="world", start=1.5, end=3.0)]
    srt = build_srt(segments)
    assert "1\n00:00:00,000 --> 00:00:01,500\nhello" in srt
    assert "2\n00:00:01,500 --> 00:00:03,000\nworld" in srt
