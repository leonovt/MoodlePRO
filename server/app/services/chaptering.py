from abc import ABC, abstractmethod


class Chapterer(ABC):
    """Extension point for the future lecture-chaptering feature."""

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
                }
            )

        return chapters

    async def make_chapters_from_text(self, text: str, num_chapters: int = 3) -> list[dict]:
        words = text.split()
        if not words:
            return []

        effective_num_chapters = min(num_chapters, len(words)) or 1
        base_size, remainder = divmod(len(words), effective_num_chapters)

        chapters = []
        start_idx = 0
        for i in range(effective_num_chapters):
            group_size = base_size + (1 if i < remainder else 0)
            if i == effective_num_chapters - 1:
                group_words = words[start_idx:]
            else:
                group_words = words[start_idx:start_idx + group_size]
            start_idx += len(group_words)

            chapters.append(
                {
                    "id": i,
                    "title": f"[FAKE] Topic {i + 1}",
                    "start": 0.0,
                    "end": 0.0,
                    "text": " ".join(group_words),
                }
            )

        return chapters
