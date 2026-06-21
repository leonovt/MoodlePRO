from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Job
from app.db.session import SessionLocal
from app.services import dedup, storage
from app.services.queue import publish_completed, publish_failed, worker_is_alive
from app.services.transcribe_groq import GroqTranscriber, TranscriptionProvider
from app.services.transcribe_ivrit import IvritServerlessTranscriber

logger = logging.getLogger(__name__)


def _fallback_configured() -> bool:
    """True when the selected cloud provider has the credentials it needs."""
    if settings.fallback_provider == "ivrit":
        return bool(settings.ivrit_endpoint_url)
    return bool(settings.groq_api_key)


def _make_provider() -> TranscriptionProvider | None:
    """Build the configured cloud transcriber, or None if it isn't set up."""
    try:
        if settings.fallback_provider == "ivrit":
            return IvritServerlessTranscriber()
        return GroqTranscriber()
    except RuntimeError:
        return None  # missing key/endpoint; nothing to fall back to

# Hold references so fire-and-forget tasks are not garbage-collected mid-flight.
_background_tasks: set[asyncio.Task] = set()


async def run_groq_fallback(
    session: AsyncSession,
    redis: Redis,
    job_id: str,
    audio_hash: str,
    audio_path: Path,
    provider: TranscriptionProvider,
    language: str = "he",
) -> bool:
    """Transcribe a queued job via the cloud provider unless it was already transcribed.

    Returns True if this call produced and persisted the transcript, or False if it was
    a no-op because a transcript already existed (e.g. a cluster worker won the race).
    The transcript is stored through the same dedup cache the worker uses, so the result
    is indistinguishable to the rest of the system.
    """
    if await dedup.find_transcript(session, audio_hash) is not None:
        return False

    # Long lectures take minutes via Groq; reflect that so the job isn't stuck at "queued".
    job = await session.get(Job, job_id)
    if job is not None and job.status not in ("completed", "failed"):
        job.status = "transcribing"
        await session.commit()

    result = await provider.transcribe(audio_path, language)

    # Re-check after the (slow) transcription: a worker may have completed meanwhile.
    if await dedup.find_transcript(session, audio_hash) is not None:
        return False

    await dedup.save_transcript(session, audio_hash, result.text, result.srt, result.language)
    job = await session.get(Job, job_id)
    if job is not None:
        job.status = "completed"
        job.provider = settings.fallback_provider  # "groq" (default) or "ivrit"
    await session.commit()

    await publish_completed(redis, job_id, result.text)
    logger.info("job %s completed via Groq fallback", job_id)
    return True


async def _worker_will_handle(redis: Redis, audio_hash: str) -> bool:
    """Poll for a live worker to finish the job, up to the grace period.

    Returns True if a transcript appeared (a worker won → skip Groq). Returns False if
    we should transcribe via Groq now — either because no worker is alive (skip the wait
    entirely) or because the grace period elapsed without one finishing.
    """
    if not settings.cluster_enabled:
        return False  # cluster path off: go straight to Groq, ignore any live worker
    loop = asyncio.get_event_loop()
    deadline = loop.time() + settings.groq_fallback_grace_seconds
    while True:
        # Fresh session each poll so we see transcripts committed by other sessions.
        async with SessionLocal() as session:
            if await dedup.find_transcript(session, audio_hash) is not None:
                return True
        if not await worker_is_alive(redis):
            return False
        remaining = deadline - loop.time()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(settings.groq_fallback_poll_seconds, remaining))


async def _fallback_task(job_id: str, audio_hash: str, language: str) -> None:
    redis = Redis.from_url(settings.redis_url)
    try:
        if await _worker_will_handle(redis, audio_hash):
            return  # a worker produced the transcript; nothing to do

        audio_path = storage.audio_path(job_id)
        if not audio_path.exists():
            logger.warning("groq fallback: audio missing for job %s, skipping", job_id)
            return

        provider = _make_provider()
        if provider is None:
            return  # no provider configured; nothing to fall back to

        async with SessionLocal() as session:
            await run_groq_fallback(
                session, redis, job_id, audio_hash, audio_path, provider, language
            )
    except Exception as exc:  # noqa: BLE001 - background task; surface to the client, don't crash
        # A transcript may have appeared meanwhile (a cluster worker won the race). If so,
        # the fallback's error is moot — don't mark the job failed or push a "failed" event,
        # which would show the user an error on a job that actually succeeded.
        async with SessionLocal() as session:
            if await dedup.find_transcript(session, audio_hash) is not None:
                logger.info(
                    "groq fallback for job %s errored, but a transcript already exists; ignoring",
                    job_id,
                )
                return
        logger.exception("groq fallback failed for job %s", job_id)
        await _mark_job_failed(job_id, f"groq fallback failed: {exc}")
        try:
            await publish_failed(redis, job_id, "groq fallback failed")
        except Exception:
            logger.exception("failed to publish groq fallback failure for job %s", job_id)
    finally:
        await redis.aclose()


async def _mark_job_failed(job_id: str, error: str) -> None:
    """Persist a failed status so a job whose fallback errored doesn't hang at 'queued'."""
    try:
        async with SessionLocal() as session:
            job = await session.get(Job, job_id)
            if job is not None and job.status != "completed":
                job.status = "failed"
                job.error = error
                await session.commit()
    except Exception:  # noqa: BLE001 - best-effort; the exception is already logged
        logger.exception("failed to mark job %s as failed", job_id)


def schedule_groq_fallback(job_id: str, audio_hash: str, language: str = "he") -> None:
    """Fire-and-forget: if no worker completes the job within the grace period, transcribe
    via the configured cloud provider (Groq by default, or ivrit serverless).

    No-op when the selected provider isn't configured. If no worker heartbeat is present,
    the grace wait is skipped and the provider runs immediately (see _worker_will_handle).
    """
    if not _fallback_configured():
        return
    task = asyncio.create_task(_fallback_task(job_id, audio_hash, language))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
