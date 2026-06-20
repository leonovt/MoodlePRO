from abc import ABC, abstractmethod


class QuizGenerator(ABC):
    """Extension point for the future quiz-generation feature."""

    @abstractmethod
    async def generate_quiz(self, text: str, num_questions: int = 3) -> list[dict]:
        ...


class FakeQuizGenerator(QuizGenerator):
    """Deterministic stub quiz generator; no LLM call, used until a real provider is wired in."""

    async def generate_quiz(self, text: str, num_questions: int = 3) -> list[dict]:
        questions = []
        for i in range(num_questions):
            questions.append(
                {
                    "question": f"[FAKE QUIZ] Stub question {i + 1} about the provided text?",
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
