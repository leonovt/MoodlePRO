import asyncio
import logging
import tempfile
from pathlib import Path

import httpx
from redis.asyncio import Redis

import client
from config import WorkerSettings, settings
from redis_queue import dequeue_job, publish_segment
from transcriber import Transcriber, build_srt, get_transcriber

logger = logging.getLogger(__name__)


async def run_once(
    redis: Redis,
    http_client: httpx.AsyncClient,
    transcriber: Transcriber,
    worker_settings: WorkerSettings,
    poll_timeout: int = 5,
) -> bool:
    """Pops one job (if any) and fully processes it. Returns True if a job was processed."""
    job_id = await dequeue_job(redis, timeout=poll_timeout)
    if job_id is None:
        return False

    logger.info("picked up job %s", job_id)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = await client.fetch_audio(http_client, worker_settings, job_id, Path(tmp) / "audio.wav")

            segments = []
            for segment in transcriber.transcribe(audio_path):
                segments.append(segment)
                await publish_segment(redis, job_id, segment.text, segment.start, segment.end)

        text = " ".join(segment.text for segment in segments)
        srt = build_srt(segments)
        await client.post_complete(http_client, worker_settings, job_id, text, srt)
        logger.info("completed job %s", job_id)
    except Exception as exc:  # noqa: BLE001 - reported back to the server, not swallowed
        logger.exception("job %s failed", job_id)
        await client.post_fail(http_client, worker_settings, job_id, str(exc))

    return True


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    redis = Redis.from_url(settings.redis_url)
    transcriber = get_transcriber(settings)
    logger.info(
        "worker started (fake_transcribe=%s, server=%s)", settings.fake_transcribe, settings.server_base_url
    )
    async with httpx.AsyncClient(base_url=settings.server_base_url, timeout=None) as http_client:
        while True:
            await run_once(redis, http_client, transcriber, settings)


if __name__ == "__main__":
    asyncio.run(main())
