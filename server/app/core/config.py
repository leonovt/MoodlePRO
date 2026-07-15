from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://moodlepro:moodlepro@localhost:5432/moodlepro"
    redis_url: str = "redis://localhost:6379/0"
    internal_api_token: str = "dev-internal-token-change-me"
    storage_dir: str = "./data"
    public_base_url: str = "http://localhost:8000"

    # Janitor: a periodic safety-net sweep of STORAGE_DIR for orphaned job dirs left by jobs
    # that died without ever hitting a cleanup path (e.g. a cluster worker crash / SLURM
    # eviction with no /complete or /fail callback). A job in flight keeps rewriting its dir
    # (download, extract, opus transcode), so a dir untouched for this many hours is dead.
    job_dir_max_age_hours: float = 6.0
    job_dir_sweep_interval_seconds: float = 1800.0
    gemini_api_key: str = ""

    # Per-user lecture quota (identified by Moodle user). Writing a review (honor system)
    # grants review_bonus_lectures more. user_id-less requests are not gated.
    base_lecture_quota: int = 5
    review_bonus_lectures: int = 5
    # Naming who invited you when leaving a review grants both accounts a referral
    # bonus (honor system, matched by self-reported Moodle username).
    referral_bonus_lectures: int = 3

    # Self-reported Moodle usernames (case-insensitive, honor system — same trust level
    # as the rest of the quota system) that never get quota-gated at all.
    unlimited_usernames: set[str] = {"leonovt", "prives"}

    # Numeric Moodle user ids (the stable "moodle:<id>" key the extension already sends
    # with every request) that never get quota-gated, with no prompt/self-report needed
    # at all. prives = 102494, other developer = 102628. (439866 was an early wrong guess
    # for leonovt's id, kept harmlessly; an id that matches nobody just never triggers.)
    unlimited_user_ids: set[str] = {
        "moodle:439866",
        "moodle:102494",
        "moodle:102628",
        "moodle:103813",
        "moodle:103238",
        "moodle:95603",
        "moodle:64340",
    }

    # Master switch for the cluster GPU worker path. When False, the server never
    # enqueues to the cluster and never waits for a worker heartbeat — every job goes
    # straight to Groq, even if a worker is alive. Keep False until the cluster path is
    # tested, so a running (test) worker can't silently serve real user jobs.
    cluster_enabled: bool = True

    # Which cloud provider transcribes when the cluster doesn't: "groq" (default, free
    # tier) or "ivrit" (self-hosted ivrit-ai model on a serverless GPU — Modal/RunPod).
    # Flip to "ivrit" + set the IVRIT_* vars to switch with no code change.
    fallback_provider: str = "groq"

    # Self-hosted ivrit.ai serverless endpoint (Hebrew-finetuned Whisper on Modal/RunPod).
    ivrit_endpoint_url: str = ""          # POST audio here; empty disables the provider
    ivrit_api_token: str = ""             # sent as "Authorization: Bearer <token>"
    ivrit_max_upload_mb: float = 90.0     # chunk audio larger than this before upload

    # Groq cloud fallback: used when no cluster GPU worker claims a queued job in time.
    groq_api_key: str = ""
    groq_model: str = "whisper-large-v3"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    # How long to wait for an ALIVE cluster worker to finish before also running Groq. A
    # long lecture can take several minutes on the cluster, and 90s fired Groq redundantly
    # almost every time (wasted quota + a racing job that could clobber the cluster's
    # result). Worker *death* is caught separately in ~30s via the heartbeat key expiring,
    # so a generous grace only delays Groq when a worker is alive but slow — when we DO
    # want to keep waiting for it.
    groq_fallback_grace_seconds: float = 300.0
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
