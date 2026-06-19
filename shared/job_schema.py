"""Reference copy of the wire contracts shared between server/ and gpu_worker/.

server/ and gpu_worker/ are separate deployable units (the worker runs on a different,
possibly home-NAT'd machine), so this file is NOT imported by either — it documents the
JSON shapes exchanged over HTTP/Redis so the two independent implementations
(`server/app/schemas.py` and `gpu_worker/transcriber.py` + `gpu_worker/redis_queue.py`)
stay in sync. If you change one side, check this file and the other side too.
"""

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class JobStatus(str, Enum):
    pending = "pending"
    downloading = "downloading"
    extracting_audio = "extracting_audio"
    queued = "queued"
    transcribing = "transcribing"
    completed = "completed"
    failed = "failed"


class JobCreateRequest(BaseModel):
    """POST /jobs body, sent by the extension."""

    video_url: str
    moodle_video_id: Optional[str] = None
    language: str = "he"


class JobCompletePayload(BaseModel):
    """POST /internal/jobs/{id}/complete body, sent by the GPU worker."""

    text: str
    srt: str
    language: str = "he"


class SegmentEvent(BaseModel):
    """Redis pub/sub message on job:{id}:segments, and the WS message forwarded to the client."""

    type: str  # "segment" | "completed" | "failed"
    job_id: str
    text: Optional[str] = None
    start: Optional[float] = None
    end: Optional[float] = None
    error: Optional[str] = None
