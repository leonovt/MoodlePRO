from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = "postgresql+asyncpg://moodlepro:moodlepro@localhost:5432/moodlepro"
    redis_url: str = "redis://localhost:6379/0"
    internal_api_token: str = "dev-internal-token-change-me"
    storage_dir: str = "./data"
    public_base_url: str = "http://localhost:8000"

    # Groq cloud fallback: used when no cluster GPU worker claims a queued job in time.
    groq_api_key: str = ""
    groq_model: str = "whisper-large-v3"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_fallback_grace_seconds: float = 90.0
    groq_fallback_poll_seconds: float = 2.0
    # Groq rejects uploads over ~25 MB (a 2h lecture as 16kHz WAV is ~230 MB). Files
    # larger than this are split into <= groq_chunk_seconds pieces, transcribed
    # separately, and stitched back with offset timestamps.
    groq_max_upload_mb: float = 24.0
    groq_chunk_seconds: float = 600.0
    # On HTTP 429 (rate limit) Groq is retried with exponential backoff, honoring a
    # Retry-After header when present, so a busy hour degrades gracefully instead of failing.
    groq_max_retries: int = 4
    groq_retry_base_seconds: float = 2.0
    groq_retry_max_seconds: float = 60.0


settings = Settings()
