import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


class Transcript(Base):
    """Permanent dedup record, keyed by the SHA-256 hash of the extracted audio."""

    __tablename__ = "transcripts"

    audio_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    language: Mapped[str] = mapped_column(String(8), default="he")
    text: Mapped[str] = mapped_column(Text)
    srt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Job(Base):
    __tablename__ = "jobs"

    # Stored as a plain string (not a Postgres-native UUID column) so the same
    # model works against SQLite in tests and Postgres in production.
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    video_url: Mapped[str] = mapped_column(Text)
    moodle_video_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Dedup lookup key into Transcript.audio_hash, NOT a hard FK: a job records its
    # hash as soon as audio extraction finishes, before a matching transcript exists,
    # so a real FK would (and did) violate on insert. Indexed because _to_response /
    # dedup look transcripts up by it.
    audio_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
