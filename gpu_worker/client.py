from pathlib import Path

import httpx

from config import WorkerSettings


def _auth_headers(settings: WorkerSettings) -> dict:
    return {"Authorization": f"Bearer {settings.internal_api_token}"}


async def claim_job(
    http_client: httpx.AsyncClient, settings: WorkerSettings, timeout: int = 5
) -> str | None:
    """Long-poll the server for the next queued job (over HTTPS, since the cluster can't
    reach Redis). Returns the job id, or None when nothing is queued."""
    response = await http_client.post(
        "/internal/jobs/claim",
        params={"timeout": timeout},
        headers=_auth_headers(settings),
        timeout=timeout + 10,
    )
    response.raise_for_status()
    return response.json().get("job_id")


async def post_heartbeat(http_client: httpx.AsyncClient, settings: WorkerSettings, ttl: int) -> None:
    response = await http_client.post(
        "/internal/worker/heartbeat",
        params={"ttl": ttl},
        headers=_auth_headers(settings),
    )
    response.raise_for_status()


async def post_segment(
    http_client: httpx.AsyncClient,
    settings: WorkerSettings,
    job_id: str,
    text: str,
    start: float,
    end: float,
) -> None:
    response = await http_client.post(
        f"/internal/jobs/{job_id}/segments",
        json={"text": text, "start": start, "end": end},
        headers=_auth_headers(settings),
    )
    response.raise_for_status()


async def post_segments_batch(
    http_client: httpx.AsyncClient,
    settings: WorkerSettings,
    job_id: str,
    segments: list,
) -> None:
    """Post several segments in one request, so the GPU isn't stalled on a round-trip per
    segment. `segments` is any sequence of objects with .text/.start/.end (Segment)."""
    if not segments:
        return
    response = await http_client.post(
        f"/internal/jobs/{job_id}/segments/batch",
        json={"segments": [{"text": s.text, "start": s.start, "end": s.end} for s in segments]},
        headers=_auth_headers(settings),
    )
    response.raise_for_status()


async def fetch_audio(http_client: httpx.AsyncClient, settings: WorkerSettings, job_id: str, dest_path: Path) -> Path:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    response = await http_client.get(f"/internal/audio/{job_id}", headers=_auth_headers(settings))
    response.raise_for_status()
    dest_path.write_bytes(response.content)
    return dest_path


async def post_complete(
    http_client: httpx.AsyncClient, settings: WorkerSettings, job_id: str, text: str, srt: str
) -> None:
    response = await http_client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": text, "srt": srt, "language": settings.language},
        headers=_auth_headers(settings),
    )
    response.raise_for_status()


async def post_fail(http_client: httpx.AsyncClient, settings: WorkerSettings, job_id: str, error: str) -> None:
    response = await http_client.post(
        f"/internal/jobs/{job_id}/fail",
        params={"error": error},
        headers=_auth_headers(settings),
    )
    response.raise_for_status()
