import json
from collections.abc import AsyncIterator

from redis.asyncio import Redis

JOB_QUEUE_KEY = "queue:jobs"

# A GPU worker SETEXs this key on a short TTL while alive. Its presence is the
# server's signal that a worker (cluster or otherwise) is around to claim jobs.
WORKER_HEARTBEAT_KEY = "worker:heartbeat"


def segment_channel(job_id: str) -> str:
    return f"job:{job_id}:segments"


async def worker_is_alive(redis: Redis) -> bool:
    return bool(await redis.exists(WORKER_HEARTBEAT_KEY))


async def enqueue_job(redis: Redis, job_id: str) -> None:
    await redis.rpush(JOB_QUEUE_KEY, job_id)


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


async def publish_completed(redis: Redis, job_id: str, text: str) -> None:
    payload = json.dumps({"type": "completed", "job_id": job_id, "text": text})
    await redis.publish(segment_channel(job_id), payload)


async def publish_failed(redis: Redis, job_id: str, error: str) -> None:
    payload = json.dumps({"type": "failed", "job_id": job_id, "error": error})
    await redis.publish(segment_channel(job_id), payload)


async def subscribe_all_segments(redis: Redis) -> AsyncIterator[dict]:
    """Yields every segment event published across all jobs (psubscribe job:*:segments)."""
    pubsub = redis.pubsub()
    await pubsub.psubscribe("job:*:segments")
    try:
        async for message in pubsub.listen():
            if message["type"] != "pmessage":
                continue
            yield json.loads(message["data"])
    finally:
        await pubsub.punsubscribe("job:*:segments")
        await pubsub.aclose()
