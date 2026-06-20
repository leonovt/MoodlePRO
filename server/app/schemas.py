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
