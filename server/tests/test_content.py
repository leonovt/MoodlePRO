from pathlib import Path

import pytest

from app.services import audio_extract, video_fetch
from app.services.chaptering import FakeChapterer
from app.services.quiz import FakeQuizGenerator
from app.services.summarizer import FakeSummarizer


@pytest.fixture(autouse=True)
def fake_pipeline(monkeypatch):
    """Stub out network/ffmpeg dependent steps so jobs can be created/completed in tests.

    Uses audio bytes that include the video URL so each job gets a distinct audio_hash
    and tests in this file don't collide (via dedup) with jobs created in test_jobs.py.
    """

    async def fake_download(video_url: str, dest_dir: Path) -> Path:
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = dest_dir / "source.mp4"
        path.write_bytes(f"fake video bytes for {video_url}".encode())
        return path

    def fake_extract(video_path: Path, dest_path: Path) -> Path:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(video_path.read_bytes())
        return dest_path

    monkeypatch.setattr(video_fetch, "download_video", fake_download)
    monkeypatch.setattr(audio_extract, "extract_audio", fake_extract)


async def test_fake_summarizer_returns_stub_string():
    result = await FakeSummarizer().summarize("one two three four five", mode="formal")
    assert "[FAKE SUMMARY]" in result
    assert "5 words" in result
    assert "formal" in result


async def test_fake_quiz_generator_shape_and_correct_index_range():
    questions = await FakeQuizGenerator().generate_quiz("some text", num_questions=5)
    assert len(questions) == 5
    for q in questions:
        assert "[FAKE QUIZ]" in q["question"]
        assert len(q["options"]) == 4
        assert 0 <= q["correct_index"] < 4
        assert isinstance(q["explanation"], str) and q["explanation"]


async def test_fake_chapterer_groups_segments_evenly_and_covers_full_range():
    segments = [
        {"text": "a", "start": 0.0, "end": 1.0},
        {"text": "b", "start": 1.0, "end": 2.0},
        {"text": "c", "start": 2.0, "end": 3.0},
        {"text": "d", "start": 3.0, "end": 4.0},
        {"text": "e", "start": 4.0, "end": 5.0},
        {"text": "f", "start": 5.0, "end": 6.0},
    ]
    chapters = await FakeChapterer().make_chapters(segments, num_chapters=3)
    assert len(chapters) == 3
    assert chapters[0]["start"] == 0.0
    assert chapters[-1]["end"] == 6.0
    for i, chapter in enumerate(chapters):
        assert chapter["id"] == i
        assert "[FAKE]" in chapter["title"]
    for i in range(len(chapters) - 1):
        assert chapters[i]["end"] <= chapters[i + 1]["start"]


async def test_fake_chapterer_fewer_segments_than_num_chapters():
    segments = [
        {"text": "a", "start": 0.0, "end": 1.0},
        {"text": "b", "start": 1.0, "end": 2.0},
    ]
    chapters = await FakeChapterer().make_chapters(segments, num_chapters=5)
    assert len(chapters) == 2


async def test_fake_chapterer_empty_segments_returns_empty():
    chapters = await FakeChapterer().make_chapters([], num_chapters=3)
    assert chapters == []


async def test_post_items_summary(client):
    response = await client.post(
        "/items/summary",
        json={"title": "Lecture 1", "text": "hello world this is a lecture", "item_type": "lecture", "mode": "casual"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "[FAKE SUMMARY]" in body["summary"]


async def test_post_items_quiz(client):
    response = await client.post(
        "/items/quiz",
        json={"title": "Lecture 1", "text": "hello world this is a lecture", "item_type": "lecture", "num_questions": 4},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 4
    for q in body["questions"]:
        assert 0 <= q["correct_index"] < 4
        assert len(q["options"]) == 4


async def test_course_summary_scope_everything(client):
    response = await client.post(
        "/courses/summary",
        json={
            "scope": "everything",
            "items": [
                {"id": "1", "item_type": "assignment", "title": "HW1", "text": "do the homework"},
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    assert "[FAKE SUMMARY]" in response.json()["summary"]


async def test_course_summary_scope_assignments(client):
    response = await client.post(
        "/courses/summary",
        json={
            "scope": "assignments",
            "items": [
                {"id": "1", "item_type": "assignment", "title": "HW1", "text": "do the homework"},
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    assert "[FAKE SUMMARY]" in response.json()["summary"]


async def test_course_summary_scope_lectures(client):
    response = await client.post(
        "/courses/summary",
        json={
            "scope": "lectures",
            "items": [
                {"id": "1", "item_type": "assignment", "title": "HW1", "text": "do the homework"},
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    assert "[FAKE SUMMARY]" in response.json()["summary"]


async def test_course_summary_empty_scope_returns_no_error(client):
    response = await client.post(
        "/courses/summary",
        json={
            "scope": "assignments",
            "items": [
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    assert "No matching items" in response.json()["summary"]


async def test_course_summary_scope_slides(client):
    response = await client.post(
        "/courses/summary",
        json={
            "scope": "slides",
            "items": [
                {"id": "1", "item_type": "slides", "title": "Slides 1", "text": "slide deck content"},
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    assert "[FAKE SUMMARY]" in response.json()["summary"]


async def test_course_quiz_scope_lectures(client):
    response = await client.post(
        "/courses/quiz",
        json={
            "scope": "lectures",
            "items": [
                {"id": "1", "item_type": "assignment", "title": "HW1", "text": "do the homework"},
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    questions = response.json()["questions"]
    assert len(questions) == 3
    for q in questions:
        assert "[FAKE QUIZ]" in q["question"]


async def test_course_quiz_empty_scope_returns_empty_questions(client):
    response = await client.post(
        "/courses/quiz",
        json={
            "scope": "slides",
            "items": [
                {"id": "2", "item_type": "lecture", "title": "L1", "text": "lecture content"},
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["questions"] == []


def _build_srt_with_three_segments(text: str) -> str:
    words = text.split()
    third = max(1, len(words) // 3)
    groups = [words[:third], words[third : 2 * third], words[2 * third :]]
    lines = []
    start = 0
    for i, group in enumerate(g for g in groups if g):
        lines.append(str(i + 1))
        lines.append(f"00:00:{start:02d},000 --> 00:00:{start + 2:02d},000")
        lines.append(" ".join(group))
        lines.append("")
        start += 2
    return "\n".join(lines)


async def _create_completed_job(client, internal_headers, video_url: str, text: str) -> str:
    create_resp = await client.post("/jobs", json={"video_url": video_url})
    job_id = create_resp.json()["id"]
    await client.post(
        f"/internal/jobs/{job_id}/complete",
        json={"text": text, "srt": _build_srt_with_three_segments(text), "language": "he"},
        headers=internal_headers,
    )
    return job_id


async def test_get_job_chapters_for_completed_job(client, internal_headers):
    text = " ".join(f"word{i}" for i in range(30))
    job_id = await _create_completed_job(client, internal_headers, "https://example.com/chapters.mp4", text)

    response = await client.get(f"/jobs/{job_id}/chapters")
    assert response.status_code == 200
    chapters = response.json()
    assert len(chapters) == 3
    for chapter in chapters:
        assert "[FAKE]" in chapter["title"]


async def test_get_job_chapters_404_for_unknown_job(client):
    response = await client.get("/jobs/does-not-exist/chapters")
    assert response.status_code == 404


async def test_chapter_summary_and_quiz_happy_path(client, internal_headers):
    text = " ".join(f"word{i}" for i in range(30))
    job_id = await _create_completed_job(client, internal_headers, "https://example.com/chapters2.mp4", text)

    chapters_resp = await client.get(f"/jobs/{job_id}/chapters")
    chapter_id = chapters_resp.json()[0]["id"]

    summary_resp = await client.post(f"/jobs/{job_id}/chapters/{chapter_id}/summary")
    assert summary_resp.status_code == 200
    assert "[FAKE SUMMARY]" in summary_resp.json()["summary"]

    quiz_resp = await client.post(f"/jobs/{job_id}/chapters/{chapter_id}/quiz")
    assert quiz_resp.status_code == 200
    assert len(quiz_resp.json()["questions"]) == 3


async def test_chapter_summary_404_for_bad_chapter_id(client, internal_headers):
    text = " ".join(f"word{i}" for i in range(30))
    job_id = await _create_completed_job(client, internal_headers, "https://example.com/chapters3.mp4", text)

    response = await client.post(f"/jobs/{job_id}/chapters/9999/summary")
    assert response.status_code == 404


async def test_chapter_quiz_404_for_bad_chapter_id(client, internal_headers):
    text = " ".join(f"word{i}" for i in range(30))
    job_id = await _create_completed_job(client, internal_headers, "https://example.com/chapters4.mp4", text)

    response = await client.post(f"/jobs/{job_id}/chapters/9999/quiz")
    assert response.status_code == 404
