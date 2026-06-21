from google import genai

from app.core.config import settings

MODEL = "gemini-3.1-flash-lite"
# Used for the assignment-solving feature, which needs more reasoning than casual summaries/quizzes.
STRONG_MODEL = "gemini-3.1-pro"

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client
