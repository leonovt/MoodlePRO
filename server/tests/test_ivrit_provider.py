import app.services.transcribe_ivrit as ti
from app.core.config import settings
from app.services import fallback
from app.services.transcribe_groq import GroqTranscriber
from app.services.transcribe_ivrit import IvritServerlessTranscriber


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None):
        self.status_code = status_code
        self._json = json_body or {}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")


class _FakeClient:
    def __init__(self, response):
        self._response = response
        self.post_calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        self.post_calls += 1
        return self._response


async def test_ivrit_small_file_single_request(monkeypatch, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x" * 128)

    fake = _FakeClient(
        _FakeResponse(json_body={"text": "שלום", "segments": [{"text": "שלום", "start": 0.0, "end": 1.5}], "language": "he"})
    )
    monkeypatch.setattr(ti.httpx, "AsyncClient", lambda *a, **k: fake)

    tr = IvritServerlessTranscriber(endpoint_url="https://ivrit.example/transcribe", api_token="t", max_upload_mb=1.0)
    result = await tr.transcribe(audio, "he")

    assert fake.post_calls == 1
    assert result.text == "שלום"
    assert "00:00:00,000 --> 00:00:01,500" in result.srt
    assert result.language == "he"


async def test_ivrit_large_file_is_chunked_and_offset(monkeypatch, tmp_path):
    audio = tmp_path / "big.wav"
    audio.write_bytes(b"x" * 4096)

    def fake_split(path, chunk_seconds, dest_dir):
        return [(0.0, dest_dir / "c0"), (600.0, dest_dir / "c1")]

    async def fake_transcribe_file(self, path, language):
        from app.services.srt import Segment
        return [Segment(text=f"seg-{path.name}", start=0.0, end=2.0)], ""

    monkeypatch.setattr(ti, "_split_audio", fake_split)
    monkeypatch.setattr(IvritServerlessTranscriber, "_transcribe_file", fake_transcribe_file)

    tr = IvritServerlessTranscriber(endpoint_url="https://ivrit.example/t", max_upload_mb=0.000001)
    result = await tr.transcribe(audio, "he")

    assert result.text == "seg-c0 seg-c1"
    assert "00:10:00,000 --> 00:10:02,000" in result.srt  # second chunk offset by 600s


def test_requires_endpoint_url():
    import pytest

    with pytest.raises(RuntimeError):
        IvritServerlessTranscriber(endpoint_url="")


def test_make_provider_selects_by_config(monkeypatch):
    # default -> groq (when key present)
    monkeypatch.setattr(settings, "fallback_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "k")
    assert isinstance(fallback._make_provider(), GroqTranscriber)

    # ivrit selected + endpoint set -> ivrit
    monkeypatch.setattr(settings, "fallback_provider", "ivrit")
    monkeypatch.setattr(settings, "ivrit_endpoint_url", "https://ivrit.example/t")
    assert isinstance(fallback._make_provider(), IvritServerlessTranscriber)

    # ivrit selected but no endpoint -> None (unconfigured)
    monkeypatch.setattr(settings, "ivrit_endpoint_url", "")
    assert fallback._make_provider() is None
    assert fallback._fallback_configured() is False
