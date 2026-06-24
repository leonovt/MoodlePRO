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
    user_id: Optional[str] = None  # Moodle user id; when set, the lecture quota applies


class CachePurgeRequest(BaseModel):
    user_id: str  # must be on the unlimited allowlist; otherwise 403
    moodle_video_ids: list[str]


class CachePurgeResponse(BaseModel):
    deleted_transcripts: int
    deleted_mappings: int
    requested_ids: int


class UsageResponse(BaseModel):
    used: int
    limit: int
    reviewed: bool
    referral_credits: int = 0
    unlimited: bool = False


class ReviewClaimRequest(BaseModel):
    username: Optional[str] = None  # self-reported, shown to others as this account's referral handle
    referred_by: Optional[str] = None  # username of whoever invited this user, if any


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: JobStatus
    video_url: str
    error: Optional[str] = None
    text: Optional[str] = None
    created_at: datetime
    from_cache: bool = False  # served from the shared cache → didn't cost a credit
    provider: Optional[str] = None  # who transcribed: cluster | groq | ivrit | cache


class SegmentEvent(BaseModel):
    job_id: str
    text: str
    start: float
    end: float


class JobCompletePayload(BaseModel):
    text: str
    srt: str
    language: str = "he"


class WorkerSegment(BaseModel):
    """One transcribed segment a GPU worker streams back over HTTPS (the worker can't
    reach Redis directly from the cluster, so it posts here and the server publishes)."""
    text: str
    start: float
    end: float


class WorkerSegmentBatch(BaseModel):
    """A batch of segments posted in one request. On a long lecture the worker produces
    thousands of segments; sending them one-per-HTTPS-call made the GPU idle waiting on
    each round-trip, so it batches them here to cut the round-trips ~batch-fold."""
    segments: list[WorkerSegment]


class SummaryRequest(BaseModel):
    title: str
    text: str
    item_type: str = "other"
    mode: str = "casual"
    file_base64: Optional[str] = None
    mime_type: Optional[str] = None


class SummaryResponse(BaseModel):
    summary: str


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class QuizRequest(BaseModel):
    title: str
    text: str
    item_type: str = "other"
    num_questions: int = 3
    difficulty: str = "medium"
    file_base64: Optional[str] = None
    mime_type: Optional[str] = None


class QuizResponse(BaseModel):
    questions: list[QuizQuestion]


class CourseSummaryScope(str, Enum):
    everything = "everything"
    assignments = "assignments"
    lectures = "lectures"
    slides = "slides"


class CourseItem(BaseModel):
    id: str
    item_type: str
    title: str
    text: str


class CourseSummaryRequest(BaseModel):
    scope: CourseSummaryScope
    items: list[CourseItem]
    num_questions: Optional[int] = 3
    difficulty: Optional[str] = "medium"


class ChapterResponse(BaseModel):
    id: int
    title: str
    start: float
    end: float
