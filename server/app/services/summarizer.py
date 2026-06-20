import base64
from abc import ABC, abstractmethod

from google.genai import types

from app.core.config import settings
from app.services.llm_client import MODEL, get_client


class SummarizerProvider(ABC):
    """Extension point for the lecture/assignment summarization feature."""

    @abstractmethod
    async def summarize(
        self, text: str, mode: str = "casual", *, file_base64: str | None = None, mime_type: str | None = None
    ) -> str:
        ...


class NotImplementedSummarizer(SummarizerProvider):
    async def summarize(
        self, text: str, mode: str = "casual", *, file_base64: str | None = None, mime_type: str | None = None
    ) -> str:
        raise NotImplementedError("Summarization is not implemented yet")


class FakeSummarizer(SummarizerProvider):
    """Deterministic stub summarizer; no LLM call, used in tests and when no API key is configured."""

    async def summarize(
        self, text: str, mode: str = "casual", *, file_base64: str | None = None, mime_type: str | None = None
    ) -> str:
        word_count = len(text.split())
        suffix = " (with an attached file)" if file_base64 else ""
        return (
            f"[FAKE SUMMARY] This is a stub summary of {word_count} words of input text "
            f"in '{mode}' mode{suffix}. Key points would appear here once a real LLM is wired in."
        )


class GeminiSummarizer(SummarizerProvider):
    """Summarizes lecture/course content with Gemini. Matches the source text's language.

    When `file_base64` is set (e.g. a slides PDF resolved straight from Moodle), the file is sent
    to Gemini directly as a document part instead of relying on any client-side text extraction.
    """

    async def summarize(
        self, text: str, mode: str = "casual", *, file_base64: str | None = None, mime_type: str | None = None
    ) -> str:
        parts = []
        if file_base64:
            parts.append(types.Part.from_bytes(data=base64.b64decode(file_base64), mime_type=mime_type or "application/pdf"))
        parts.append(types.Part.from_text(text=text or "Summarize this document."))

        response = await get_client().aio.models.generate_content(
            model=MODEL,
            contents=parts,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You summarize university course material (lecture transcripts, assignments, slides) "
                    "for students studying for exams. Write the summary in the same language as the source "
                    f"text (Hebrew source stays Hebrew). Match a '{mode}' tone. Be concise and focus on the "
                    "key points a student needs to study."
                )
            ),
        )
        return response.text


def get_summarizer() -> SummarizerProvider:
    if settings.gemini_api_key:
        return GeminiSummarizer()
    return FakeSummarizer()
