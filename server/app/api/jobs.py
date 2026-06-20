from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Job
from app.db.session import get_session
from app.schemas import JobCreateRequest, JobResponse, JobStatus
from app.services import audio_extract, dedup, storage, video_fetch
from app.services.fallback import schedule_groq_fallback
from app.services.jobs import get_job_or_404
from app.services.queue import enqueue_job

router = APIRouter()


def get_redis() -> Redis:
    return Redis.from_url(settings.redis_url)


async def _to_response(session: AsyncSession, job: Job) -> JobResponse:
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
    )


@router.post("/jobs", response_model=JobResponse)
async def create_job(
    request: JobCreateRequest,
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> JobResponse:
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

    cached = await dedup.find_transcript(session, audio_hash)
    if cached is not None:
        job.status = JobStatus.completed
        await session.commit()
        return await _to_response(session, job)

    job.status = JobStatus.queued
    await session.commit()
    # Only expose the job to the cluster when that path is enabled; otherwise a running
    # (test) worker must never pick up a real user's job. Groq handles it either way.
    if settings.cluster_enabled:
        await enqueue_job(redis, job.id)
    schedule_groq_fallback(job.id, audio_hash, request.language)
    return await _to_response(session, job)


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
