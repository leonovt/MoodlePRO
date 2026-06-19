from pathlib import Path

import httpx

from config import WorkerSettings


def _auth_headers(settings: WorkerSettings) -> dict:
    return {"Authorization": f"Bearer {settings.internal_api_token}"}


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
