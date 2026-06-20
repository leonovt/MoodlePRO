import json
from abc import ABC, abstractmethod

from google.genai import types

from app.core.config import settings
from app.services.llm_client import MODEL, get_client

_CHAPTER_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "chapters": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "title": types.Schema(type=types.Type.STRING),
                    "start_segment_index": types.Schema(type=types.Type.INTEGER),
                    "end_segment_index": types.Schema(type=types.Type.INTEGER),
                },
                required=["title", "start_segment_index", "end_segment_index"],
            ),
        )
    },
    required=["chapters"],
)


class Chapterer(ABC):
    """Extension point for the lecture-chaptering feature."""

    @abstractmethod
    async def make_chapters(self, segments: list[dict], num_chapters: int = 3) -> list[dict]:
        ...


class FakeChapterer(Chapterer):
    """Deterministic stub chapterer; no LLM call, used until a real provider is wired in."""

    async def make_chapters(self, segments: list[dict], num_chapters: int = 3) -> list[dict]:
        if not segments:
            return []

        effective_num_chapters = min(num_chapters, len(segments))
        if effective_num_chapters <= 0:
            return []

        base_size, remainder = divmod(len(segments), effective_num_chapters)

        chapters = []
        start_idx = 0
        for i in range(effective_num_chapters):
            group_size = base_size + (1 if i < remainder else 0)
            if i == effective_num_chapters - 1:
                group = segments[start_idx:]
            else:
                group = segments[start_idx:start_idx + group_size]
            start_idx += len(group)

            chapters.append(
                {
                    "id": i,
                    "title": f"[FAKE] Topic {i + 1}",
                    "start": group[0]["start"],
                    "end": group[-1]["end"],
                    "text": " ".join(seg["text"] for seg in group),
                }
            )

        return chapters


class GeminiChapterer(Chapterer):
    """Splits a transcript into named chapters with Gemini, using real per-segment timestamps."""

    async def make_chapters(self, segments: list[dict], num_chapters: int = 3) -> list[dict]:
        if not segments:
            return []

        numbered = "\n".join(f"[{i}] {seg['text']}" for i, seg in enumerate(segments))
        response = await get_client().aio.models.generate_content(
            model=MODEL,
            contents=numbered,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You split a lecture transcript into topical chapters. The transcript is given as "
                    "numbered lines, one per spoken segment. Group the segments into about "
                    f"{num_chapters} chapters covering the FULL range with no gaps or overlaps: the first "
                    "chapter must start at segment 0, the last must end at the final segment index, and "
                    "each chapter's start index must equal the previous chapter's end index + 1. Give each "
                    "chapter a short descriptive title in the same language as the transcript."
                ),
                response_mime_type="application/json",
                response_schema=_CHAPTER_SCHEMA,
            ),
        )
        raw_chapters = json.loads(response.text)["chapters"]

        chapters = []
        last_end = len(segments) - 1
        for i, chapter in enumerate(raw_chapters):
            start_idx = max(0, min(chapter["start_segment_index"], last_end))
            end_idx = max(start_idx, min(chapter["end_segment_index"], last_end))
            group = segments[start_idx : end_idx + 1]
            chapters.append(
                {
                    "id": i,
                    "title": chapter["title"],
                    "start": group[0]["start"],
                    "end": group[-1]["end"],
                    "text": " ".join(seg["text"] for seg in group),
                }
            )
        return chapters


def get_chapterer() -> Chapterer:
    if settings.gemini_api_key:
        return GeminiChapterer()
    return FakeChapterer()
