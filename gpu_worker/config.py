from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # The worker talks to the server over HTTPS only (claim jobs, heartbeat, stream
    # segments, post results) — it never connects to Redis, so the cluster firewall
    # allowing just 80/443 outbound is enough. No REDIS_URL needed here.
    server_base_url: str = "http://localhost:8000"
    internal_api_token: str = "dev-internal-token-change-me"

    # Liveness heartbeat: the server skips the Groq fallback wait when this is absent.
    # TTL must comfortably exceed the interval so a single missed beat doesn't expire it.
    heartbeat_interval_seconds: int = 10
    heartbeat_ttl_seconds: int = 30

    # Until a real RTX 4090 + ivrit-ai model is wired up, the worker fakes
    # transcription so the rest of the pipeline (queue, streaming, storage)
    # can be built and tested end-to-end.
    fake_transcribe: bool = True
    model_name: str = "ivrit-ai/whisper-large-v3-turbo-ct2"
    device: str = "cuda"
    compute_type: str = "float16"
    language: str = "he"
    # Batched inference parallelizes chunks for a big speedup (2-4x) over sequential
    # decoding; VAD skips silence. batch_size trades VRAM for speed — 16 fits the turbo
    # model on a 24GB card comfortably. Set to 1 to effectively disable batching.
    batch_size: int = 16


settings = WorkerSettings()
