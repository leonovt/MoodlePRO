from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = "postgresql+asyncpg://moodlepro:moodlepro@localhost:5432/moodlepro"
    redis_url: str = "redis://localhost:6379/0"
    internal_api_token: str = "dev-internal-token-change-me"
    storage_dir: str = "./data"
    public_base_url: str = "http://localhost:8000"


settings = Settings()
