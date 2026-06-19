import json

from redis.asyncio import Redis

JOB_QUEUE_KEY = "queue:jobs"


def segment_channel(job_id: str) -> str:
    return f"job:{job_id}:segments"


async def dequeue_job(redis: Redis, timeout: int = 5) -> str | None:
    result = await redis.blpop([JOB_QUEUE_KEY], timeout=timeout)
    if result is None:
        return None
    _, job_id = result
    return job_id.decode() if isinstance(job_id, bytes) else job_id


async def publish_segment(redis: Redis, job_id: str, text: str, start: float, end: float) -> None:
    payload = json.dumps(
        {"type": "segment", "job_id": job_id, "text": text, "start": start, "end": end}
    )
    await redis.publish(segment_channel(job_id), payload)
