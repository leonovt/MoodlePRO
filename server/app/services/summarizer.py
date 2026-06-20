from abc import ABC, abstractmethod


class SummarizerProvider(ABC):
    """Extension point for the future lecture/assignment summarization feature."""

    @abstractmethod
    async def summarize(self, text: str, mode: str = "casual") -> str:
        ...


class NotImplementedSummarizer(SummarizerProvider):
    async def summarize(self, text: str, mode: str = "casual") -> str:
        raise NotImplementedError("Summarization is not implemented yet")


class FakeSummarizer(SummarizerProvider):
    """Deterministic stub summarizer; no LLM call, used until a real provider is wired in."""

    async def summarize(self, text: str, mode: str = "casual") -> str:
        word_count = len(text.split())
        return (
            f"[FAKE SUMMARY] This is a stub summary of {word_count} words of input text "
            f"in '{mode}' mode. Key points would appear here once a real LLM is wired in."
        )
