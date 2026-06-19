import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import httpx


def _looks_like_direct_media_url(video_url: str) -> bool:
    path = urlparse(video_url).path.lower()
    return path.endswith((".mp4", ".m3u8", ".webm"))


async def download_video(video_url: str, dest_dir: Path) -> Path:
    """Downloads a lecture video to dest_dir, returning the local file path.

    BGU Moodle videos are direct, unencrypted MP4 files on CloudFront, so the
    common case is a plain HTTP fetch. yt-dlp is kept as a fallback for any
    other Moodle instance that serves video through a non-direct player.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / "source.mp4"

    if _looks_like_direct_media_url(video_url):
        async with httpx.AsyncClient(follow_redirects=True, timeout=None) as client:
            async with client.stream("GET", video_url) as response:
                response.raise_for_status()
                with dest_path.open("wb") as f:
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
        return dest_path

    if shutil.which("yt-dlp") is None:
        raise RuntimeError(f"'{video_url}' is not a direct media URL and yt-dlp is not installed")

    subprocess.run(
        ["yt-dlp", "-o", str(dest_path), video_url],
        check=True,
        capture_output=True,
    )
    return dest_path
