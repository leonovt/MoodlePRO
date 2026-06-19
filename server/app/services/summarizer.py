from abc import ABC, abstractmethod


class SummarizerProvider(ABC):
    """Extension point for the future lecture/assignment summarization feature."""

    @abstractmethod
    async def summarize(self, text: str, mode: str = "casual") -> str:
        ...


class NotImplementedSummarizer(SummarizerProvider):
    async def summarize(self, text: str, mode: str = "casual") -> str:
        raise NotImplementedError("Summarization is not implemented yet")
