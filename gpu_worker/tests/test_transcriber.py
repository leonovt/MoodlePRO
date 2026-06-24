import wave

from transcriber import (
    FakeTranscriber,
    Segment,
    build_srt,
    plan_detection_windows,
    resolve_language,
    select_model_key,
    vote_language,
)


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


def test_resolve_language_autodetects_for_auto_or_empty():
    # "auto"/empty -> None so Whisper detects the language instead of forcing one.
    assert resolve_language("auto") is None
    assert resolve_language("AUTO") is None
    assert resolve_language("") is None
    assert resolve_language(None) is None
    # An explicit language is passed through unchanged.
    assert resolve_language("he") == "he"
    assert resolve_language("en") == "en"


def test_select_model_key_routes_hebrew_to_primary_others_to_secondary():
    # With a secondary (stock) model loaded: Hebrew -> ivrit primary, everything else -> stock.
    assert select_model_key("he", has_secondary=True) == "primary"
    assert select_model_key("en", has_secondary=True) == "secondary"
    assert select_model_key("ru", has_secondary=True) == "secondary"
    assert select_model_key(None, has_secondary=True) == "secondary"
    # No secondary loaded -> always the primary (legacy single-model behavior).
    assert select_model_key("en", has_secondary=False) == "primary"
    assert select_model_key("he", has_secondary=False) == "primary"


def test_plan_detection_windows_spreads_across_audio():
    # 100s of 16kHz audio, 30s windows at fractions 0.1..0.9 -> several in-bounds ranges.
    total = 100 * 16000
    window = 30 * 16000
    windows = plan_detection_windows(total, window)
    assert len(windows) >= 2
    # Every window stays within [0, total] and has the requested length.
    for start, end in windows:
        assert 0 <= start < end <= total
        assert end - start == window
    # Spread out: not all starting at 0.
    assert len({start for start, _ in windows}) == len(windows)


def test_plan_detection_windows_returns_empty_when_shorter_than_one_window():
    # Audio shorter than a single window -> caller should detect on the whole clip.
    assert plan_detection_windows(10 * 16000, 30 * 16000) == []


def test_plan_detection_windows_dedupes_collapsed_starts():
    # On short-ish audio several fractions clamp to the same start; don't detect it twice.
    total = 31 * 16000
    window = 30 * 16000
    windows = plan_detection_windows(total, window)
    starts = [start for start, _ in windows]
    assert len(starts) == len(set(starts))


def test_vote_language_weighs_confidence_not_just_count():
    # One confident English window beats two low-confidence Hebrew windows.
    assert vote_language([("en", 0.95), ("he", 0.30), ("he", 0.30)]) == "en"
    # Clear Hebrew majority.
    assert vote_language([("he", 0.9), ("he", 0.8), ("en", 0.4)]) == "he"


def test_vote_language_ignores_empty_detections():
    assert vote_language([]) is None
    assert vote_language([(None, 0.9), ("", 0.8)]) is None
    # None/empty entries are skipped but real ones still count.
    assert vote_language([(None, 0.9), ("he", 0.5)]) == "he"


def test_build_srt_formats_timestamps_and_text():
    segments = [Segment(text="hello", start=0.0, end=1.5), Segment(text="world", start=1.5, end=3.0)]
    srt = build_srt(segments)
    assert "1\n00:00:00,000 --> 00:00:01,500\nhello" in srt
    assert "2\n00:00:01,500 --> 00:00:03,000\nworld" in srt
