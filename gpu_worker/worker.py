import asyncio
import logging
import tempfile
import time
from pathlib import Path

import httpx

import client
from config import WorkerSettings, settings
from transcriber import Transcriber, build_srt, get_transcriber

logger = logging.getLogger(__name__)

# How many segments to batch into a single POST. faster-whisper yields one short segment
# at a time; posting each individually made the GPU idle on a round-trip per segment.
SEGMENT_BATCH_SIZE = 25


async def _transcribe_and_stream(
    http_client: httpx.AsyncClient,
    transcriber: Transcriber,
    worker_settings: WorkerSettings,
    job_id: str,
    audio_path: Path,
) -> list:
    """Run the blocking GPU generator in a thread, feeding segments into a queue, while this
    coroutine drains the queue and posts them in batches.

    Previously this was serial: decode one segment on the GPU, block on its HTTPS POST,
    decode the next — so the GPU sat idle during every round-trip. Now decoding (thread)
    and posting (event loop) overlap, and segments go out SEGMENT_BATCH_SIZE at a time,
    cutting the number of round-trips. The bounded queue gives backpressure so a slow
    network can't let segments pile up in memory unboundedly."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=512)
    _DONE = object()

    def produce() -> None:
        try:
            for segment in transcriber.transcribe(audio_path):
                asyncio.run_coroutine_threadsafe(queue.put(segment), loop).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(_DONE), loop).result()

    producer = loop.run_in_executor(None, produce)

    segments: list = []
    batch: list = []
    while True:
        item = await queue.get()
        if item is _DONE:
            break
        segments.append(item)
        batch.append(item)
        if len(batch) >= SEGMENT_BATCH_SIZE:
            await client.post_segments_batch(http_client, worker_settings, job_id, batch)
            batch = []
    if batch:
        await client.post_segments_batch(http_client, worker_settings, job_id, batch)

    await producer  # re-raise any exception that happened inside the generator thread
    return segments


async def run_once(
    http_client: httpx.AsyncClient,
    transcriber: Transcriber,
    worker_settings: WorkerSettings,
    poll_timeout: int = 5,
) -> bool:
    """Claims one job (if any) and fully processes it. Returns True if a job was processed.

    Everything goes over HTTPS to the server — the cluster firewall only allows 80/443
    outbound, so the worker never touches Redis directly."""
    job_id = await client.claim_job(http_client, worker_settings, timeout=poll_timeout)
    if job_id is None:
        return False

    logger.info("picked up job %s", job_id)
    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            audio_path = await client.fetch_audio(http_client, worker_settings, job_id, Path(tmp) / "audio.wav")
            fetched = time.monotonic()

            segments = await _transcribe_and_stream(
                http_client, transcriber, worker_settings, job_id, audio_path
            )
            transcribed = time.monotonic()

        text = " ".join(segment.text for segment in segments)
        srt = build_srt(segments)
        language = getattr(transcriber, "detected_language", None) or worker_settings.language
        await client.post_complete(http_client, worker_settings, job_id, text, srt, language=language)
        logger.info(
            "completed job %s: %d segments, lang=%s, fetch=%.1fs transcribe+stream=%.1fs total=%.1fs",
            job_id, len(segments), language, fetched - started, transcribed - fetched,
            time.monotonic() - started,
        )
    except Exception as exc:  # noqa: BLE001 - reported back to the server, not swallowed
        logger.exception("job %s failed", job_id)
        await client.post_fail(http_client, worker_settings, job_id, str(exc))

    return True


async def _heartbeat_loop(http_client: httpx.AsyncClient, worker_settings: WorkerSettings) -> None:
    """Periodically refresh the liveness key (via the server) so its Groq fallback can tell
    a worker is around to claim jobs."""
    while True:
        try:
            await client.post_heartbeat(http_client, worker_settings, worker_settings.heartbeat_ttl_seconds)
        except Exception:  # noqa: BLE001 - a dropped beat must not kill the worker
            logger.exception("failed to publish heartbeat")
        await asyncio.sleep(worker_settings.heartbeat_interval_seconds)


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    transcriber = get_transcriber(settings)
    logger.info(
        "worker started (fake_transcribe=%s, server=%s)", settings.fake_transcribe, settings.server_base_url
    )
    async with httpx.AsyncClient(base_url=settings.server_base_url, timeout=None) as http_client:
        await client.post_heartbeat(http_client, settings, settings.heartbeat_ttl_seconds)  # announce first
        heartbeat_task = asyncio.create_task(_heartbeat_loop(http_client, settings))
        try:
            while True:
                try:
                    await run_once(http_client, transcriber, settings)
                except Exception:  # noqa: BLE001 - a transient server/network blip on claim
                    # must NOT kill a long-lived worker; log and retry shortly.
                    logger.exception("worker loop iteration failed; retrying")
                    await asyncio.sleep(5)
        finally:
            heartbeat_task.cancel()


if __name__ == "__main__":
    asyncio.run(main())
