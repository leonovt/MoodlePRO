from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import require_internal_token
from app.db.session import get_session
from app.schemas import JobCompletePayload, WorkerSegment, WorkerSegmentBatch
from app.services import dedup, storage
from app.services.jobs import get_job_or_404
from app.services.queue import (
    dequeue_job,
    publish_completed,
    publish_segment,
    set_worker_heartbeat,
)

router = APIRouter(prefix="/internal", dependencies=[Depends(require_internal_token)])


def get_redis() -> Redis:
    return Redis.from_url(settings.redis_url)


@router.post("/jobs/claim")
async def claim_job(timeout: int = 5, redis: Redis = Depends(get_redis)) -> dict:
    """A GPU worker long-polls this (over HTTPS) to pop the next queued job, instead of
    doing BLPOP on Redis directly — the cluster firewall only lets 80/443 out."""
    job_id = await dequeue_job(redis, timeout=timeout)
    return {"job_id": job_id}


@router.post("/worker/heartbeat")
async def worker_heartbeat(ttl: int = 30, redis: Redis = Depends(get_redis)) -> dict:
    await set_worker_heartbeat(redis, ttl)
    return {"status": "ok"}


@router.post("/jobs/{job_id}/segments")
async def publish_job_segment(
    job_id: str,
    payload: WorkerSegment,
    redis: Redis = Depends(get_redis),
) -> dict:
    """The worker streams each transcribed segment here; the server publishes it to the
    job's Redis channel so the browser's WebSocket receives it live."""
    await publish_segment(redis, job_id, payload.text, payload.start, payload.end)
    return {"status": "ok"}


@router.post("/jobs/{job_id}/segments/batch")
async def publish_job_segments(
    job_id: str,
    payload: WorkerSegmentBatch,
    redis: Redis = Depends(get_redis),
) -> dict:
    """Batched version of /segments: the worker sends many segments in one request so its
    GPU doesn't idle on a round-trip per segment. Each is still published to the job's
    Redis channel in order, so the browser's WebSocket receives them just as before."""
    for segment in payload.segments:
        await publish_segment(redis, job_id, segment.text, segment.start, segment.end)
    return {"status": "ok", "count": len(payload.segments)}


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
    job.provider = "cluster"  # this endpoint is only called by the GPU worker
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
