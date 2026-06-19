from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    redis_url: str = "redis://localhost:6379/0"
    server_base_url: str = "http://localhost:8000"
    internal_api_token: str = "dev-internal-token-change-me"

    # Until a real RTX 4090 + ivrit-ai model is wired up, the worker fakes
    # transcription so the rest of the pipeline (queue, streaming, storage)
    # can be built and tested end-to-end.
    fake_transcribe: bool = True
    model_name: str = "ivrit-ai/whisper-large-v3-turbo-ct2"
    device: str = "cuda"
    compute_type: str = "float16"
    language: str = "he"


settings = WorkerSettings()
