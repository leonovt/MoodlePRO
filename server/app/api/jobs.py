from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Job, VideoHash
from app.db.session import get_session
from app.schemas import JobCreateRequest, JobResponse, JobStatus
from app.services import audio_extract, dedup, storage, usage, video_fetch
from app.services.fallback import schedule_groq_fallback
from app.services.jobs import get_job_or_404
from app.services.queue import enqueue_job

router = APIRouter()


def get_redis() -> Redis:
    return Redis.from_url(settings.redis_url)


async def _to_response(session: AsyncSession, job: Job, from_cache: bool = False) -> JobResponse:
    text = None
    if job.audio_hash is not None:
        transcript = await dedup.find_transcript(session, job.audio_hash)
        text = transcript.text if transcript else None
    return JobResponse(
        id=job.id,
        status=JobStatus(job.status),
        video_url=job.video_url,
        error=job.error,
        text=text,
        created_at=job.created_at,
        from_cache=from_cache,
        provider=job.provider,
    )


async def _remember_video_hash(session: AsyncSession, moodle_video_id: str, audio_hash: str) -> None:
    mapping = await session.get(VideoHash, moodle_video_id)
    if mapping is None:
        session.add(VideoHash(moodle_video_id=moodle_video_id, audio_hash=audio_hash))
    else:
        mapping.audio_hash = audio_hash


@router.post("/jobs", response_model=JobResponse)
async def create_job(
    request: JobCreateRequest,
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> JobResponse:
    lecture_key = request.moodle_video_id or request.video_url

    # Fast path: a lecture we've already transcribed -> serve from cache, no download, and
    # for free (cache hits never cost a credit).
    if request.moodle_video_id:
        mapping = await session.get(VideoHash, request.moodle_video_id)
        if mapping is not None and await dedup.find_transcript(session, mapping.audio_hash):
            job = Job(
                video_url=request.video_url,
                moodle_video_id=request.moodle_video_id,
                audio_hash=mapping.audio_hash,
                status=JobStatus.completed,
                provider="cache",
            )
            session.add(job)
            await session.commit()
            return await _to_response(session, job, from_cache=True)

    # Quota pre-check BEFORE the slow download/extract, so an over-quota user gets an
    # immediate 403 instead of waiting minutes for the file to download first. This is a
    # read-only check; the authoritative reservation still happens after the content-hash
    # cache check below (so cache hits stay free). Edge case: a user who is over quota and
    # requests a NEW moodle id whose audio happens to already be cached under a different
    # id is rejected here even though it would have been free — rare, and acceptable.
    if request.user_id and not await usage.can_transcribe(session, request.user_id, lecture_key):
        raise HTTPException(status_code=403, detail="lecture_quota_reached")

    job = Job(
        video_url=request.video_url,
        moodle_video_id=request.moodle_video_id,
        status=JobStatus.downloading,
    )
    session.add(job)
    await session.flush()

    try:
        video_path = await video_fetch.download_video(request.video_url, storage.job_dir(job.id))
        job.status = JobStatus.extracting_audio
        await session.flush()

        audio_extract.extract_audio(video_path, storage.audio_path(job.id))
        audio_hash = audio_extract.hash_audio(storage.audio_path(job.id))
        job.audio_hash = audio_hash
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as a failed job
        job.status = JobStatus.failed
        job.error = str(exc)
        await session.commit()
        return await _to_response(session, job)

    if request.moodle_video_id:
        await _remember_video_hash(session, request.moodle_video_id, audio_hash)

    cached = await dedup.find_transcript(session, audio_hash)
    if cached is not None:
        # Cache hit discovered after hashing — also free.
        job.status = JobStatus.completed
        job.provider = "cache"
        await session.commit()
        return await _to_response(session, job, from_cache=True)

    # A real transcription is needed — only NOW does it count against the user's quota.
    if request.user_id:
        if not await usage.check_and_reserve(session, request.user_id, lecture_key):
            raise HTTPException(status_code=403, detail="lecture_quota_reached")

    job.status = JobStatus.queued
    await session.commit()
    # Only expose the job to the cluster when that path is enabled; otherwise a running
    # (test) worker must never pick up a real user's job. Groq handles it either way.
    if settings.cluster_enabled:
        await enqueue_job(redis, job.id)
    schedule_groq_fallback(job.id, audio_hash, request.language)
    return await _to_response(session, job)


@router.get("/jobs/recent")
async def recent_jobs(limit: int = 10, session: AsyncSession = Depends(get_session)) -> list[dict]:
    """The last N jobs with their routing provider — a quick window into who transcribed
    what (cluster | groq | ivrit | cache) without grepping logs or psql. Defined before
    /jobs/{job_id} so "recent" isn't matched as a job id."""
    result = await session.execute(select(Job).order_by(Job.created_at.desc()).limit(limit))
    return [
        {
            "id": job.id,
            "status": job.status,
            "provider": job.provider,
            "error": job.error,
            "created_at": job.created_at,
        }
        for job in result.scalars().all()
    ]


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, session: AsyncSession = Depends(get_session)) -> JobResponse:
    job = await get_job_or_404(session, job_id)
    return await _to_response(session, job)


@router.get("/jobs/{job_id}/txt", response_class=PlainTextResponse)
async def get_job_txt(job_id: str, session: AsyncSession = Depends(get_session)) -> str:
    job = await get_job_or_404(session, job_id)
    if job.audio_hash is None:
        raise HTTPException(status_code=409, detail="Job has no transcript yet")
    transcript = await dedup.find_transcript(session, job.audio_hash)
    if transcript is None:
        raise HTTPException(status_code=409, detail="Job has no transcript yet")
    return transcript.text


@router.get("/jobs/{job_id}/srt", response_class=PlainTextResponse)
async def get_job_srt(job_id: str, session: AsyncSession = Depends(get_session)) -> str:
    job = await get_job_or_404(session, job_id)
    if job.audio_hash is None:
        raise HTTPException(status_code=409, detail="Job has no transcript yet")
    transcript = await dedup.find_transcript(session, job.audio_hash)
    if transcript is None:
        raise HTTPException(status_code=409, detail="Job has no transcript yet")
    return transcript.srt
