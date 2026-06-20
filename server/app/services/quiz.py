import base64
import json
from abc import ABC, abstractmethod

from google.genai import types

from app.core.config import settings
from app.services.llm_client import MODEL, get_client

_QUIZ_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "questions": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "question": types.Schema(type=types.Type.STRING),
                    "options": types.Schema(type=types.Type.ARRAY, items=types.Schema(type=types.Type.STRING)),
                    "correct_index": types.Schema(type=types.Type.INTEGER),
                    "explanation": types.Schema(type=types.Type.STRING),
                },
                required=["question", "options", "correct_index", "explanation"],
            ),
        )
    },
    required=["questions"],
)


class QuizGenerator(ABC):
    """Extension point for the quiz-generation feature."""

    @abstractmethod
    async def generate_quiz(
        self,
        text: str,
        num_questions: int = 3,
        difficulty: str = "medium",
        *,
        file_base64: str | None = None,
        mime_type: str | None = None,
    ) -> list[dict]:
        ...


class FakeQuizGenerator(QuizGenerator):
    """Deterministic stub quiz generator; no LLM call, used in tests and when no API key is configured."""

    async def generate_quiz(
        self,
        text: str,
        num_questions: int = 3,
        difficulty: str = "medium",
        *,
        file_base64: str | None = None,
        mime_type: str | None = None,
    ) -> list[dict]:
        questions = []
        for i in range(num_questions):
            questions.append(
                {
                    "question": f"[FAKE QUIZ] Stub question {i + 1} ({difficulty}) about the provided text?",
                    "options": [
                        f"[FAKE] Option A for question {i + 1}",
                        f"[FAKE] Option B for question {i + 1}",
                        f"[FAKE] Option C for question {i + 1}",
                        f"[FAKE] Option D for question {i + 1}",
                    ],
                    "correct_index": i % 4,
                    "explanation": (
                        f"[FAKE QUIZ] This is a stub explanation for question {i + 1}; "
                        "a real explanation will appear once a real LLM is wired in."
                    ),
                }
            )
        return questions


class GeminiQuizGenerator(QuizGenerator):
    """Generates multiple-choice quiz questions with Gemini. Matches the source text's language.

    When `file_base64` is set (e.g. a slides PDF resolved straight from Moodle), the file is sent
    to Gemini directly as a document part instead of relying on any client-side text extraction.
    """

    async def generate_quiz(
        self,
        text: str,
        num_questions: int = 3,
        difficulty: str = "medium",
        *,
        file_base64: str | None = None,
        mime_type: str | None = None,
    ) -> list[dict]:
        parts = []
        if file_base64:
            parts.append(types.Part.from_bytes(data=base64.b64decode(file_base64), mime_type=mime_type or "application/pdf"))
        parts.append(types.Part.from_text(text=f"Write exactly {num_questions} quiz questions for this material:\n\n{text}"))

        response = await get_client().aio.models.generate_content(
            model=MODEL,
            contents=parts,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You write multiple-choice quiz questions from university course material. "
                    f"Set the difficulty level to: {difficulty}. "
                    "Focus strictly on the concepts, facts, and details present in the provided material. "
                    "Do NOT ask about external, general, or irrelevant facts that are not explicitly "
                    "covered in the provided text. "
                    "Write questions, options, and explanations in the same language as the source text "
                    "(Hebrew source stays Hebrew). Each question must have exactly 4 options with exactly "
                    "one correct answer, plus a short explanation of why it's correct."
                ),
                response_mime_type="application/json",
                response_schema=_QUIZ_SCHEMA,
            ),
        )
        return json.loads(response.text)["questions"]


def get_quiz_generator() -> QuizGenerator:
    if settings.gemini_api_key:
        return GeminiQuizGenerator()
    return FakeQuizGenerator()
