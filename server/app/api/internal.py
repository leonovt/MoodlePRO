from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import require_internal_token
from app.db.session import get_session
from app.schemas import JobCompletePayload
from app.services import dedup, storage
from app.services.jobs import get_job_or_404
from app.services.queue import publish_completed

router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_token)])


def get_redis() -> Redis:
    return Redis.from_url(settings.redis_url)


@router.get("/audio/{job_id}")
async def get_audio(job_id: str) -> FileResponse:
    path = storage.audio_path(job_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio not found for job")
    return FileResponse(path, media_type="audio/wav")


@router.post("/jobs/{job_id}/complete")
async def complete_job(
    job_id: str,
    payload: JobCompletePayload,
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> dict:
    job = await get_job_or_404(session, job_id)
    if job.audio_hash is None:
        raise HTTPException(status_code=409, detail="Job has no audio_hash; cannot persist transcript")

    await dedup.save_transcript(session, job.audio_hash, payload.text, payload.srt, payload.language)
    job.status = "completed"
    await session.commit()

    await publish_completed(redis, job_id, payload.text)
    return {"status": "completed"}


@router.post("/jobs/{job_id}/fail")
async def fail_job(
    job_id: str,
    error: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    job = await get_job_or_404(session, job_id)
    job.status = "failed"
    job.error = error
    await session.commit()
    return {"status": "failed"}
