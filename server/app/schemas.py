from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict


class JobStatus(str, Enum):
    pending = "pending"
    downloading = "downloading"
    extracting_audio = "extracting_audio"
    queued = "queued"
    transcribing = "transcribing"
    completed = "completed"
    failed = "failed"


class JobCreateRequest(BaseModel):
    video_url: str
    moodle_video_id: Optional[str] = None
    language: str = "he"


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: JobStatus
    video_url: str
    error: Optional[str] = None
    text: Optional[str] = None
    created_at: datetime


class SegmentEvent(BaseModel):
    job_id: str
    text: str
    start: float
    end: float


class JobCompletePayload(BaseModel):
    text: str
    srt: str
    language: str = "he"
