from pathlib import Path

import pytest

from app.core.config import settings
from app.db.session import SessionLocal
from app.services import audio_extract, dedup, video_fetch


@pytest.fixture(autouse=True)
def fake_pipeline(monkeypatch):
    """Stub download + extraction so create_job reaches the cache/quota logic."""

    async def fake_download(video_url, dest_dir):
        dest_dir.mkdir(parents=True, exist_ok=True)
        path = dest_dir / "source.mp4"
        path.write_bytes(b"fake")
        return path

    def fake_extract(video_path, dest_path):
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(b"fake audio")
        return dest_path

    monkeypatch.setattr(video_fetch, "download_video", fake_download)
    monkeypatch.setattr(audio_extract, "extract_audio", fake_extract)


async def _post_job(client, user_id, video_id):
    return await client.post(
        "/jobs",
        json={
            "video_url": f"https://example.com/{video_id}.mp4",
            "moodle_video_id": video_id,
            "user_id": user_id,
        },
    )


async def test_quota_blocks_after_base_limit(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 3)
    # each job gets a distinct audio hash so nothing is treated as a cache hit
    counter = {"n": 0}

    def fake_hash(_path):
        counter["n"] += 1
        return f"hash-{counter['n']}"

    monkeypatch.setattr(audio_extract, "hash_audio", fake_hash)

    for i in range(3):
        resp = await _post_job(client, "user-A", f"lec-{i}")
        assert resp.status_code == 200

    blocked = await _post_job(client, "user-A", "lec-3")
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "lecture_quota_reached"


async def test_over_quota_rejected_before_download(client, monkeypatch):
    """The 403 must come UP FRONT — before the slow download/extract — so the user gets
    an immediate out-of-credits message instead of waiting for the file to download."""
    monkeypatch.setattr(settings, "base_lecture_quota", 1)
    counter = {"n": 0}
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: f"hash-{(counter.__setitem__('n', counter['n'] + 1) or counter['n'])}")

    assert (await _post_job(client, "user-fast", "lec-0")).status_code == 200

    # Now over quota: the pipeline must NOT run for the rejected request.
    called = {"download": False, "extract": False}

    async def spy_download(video_url, dest_dir):
        called["download"] = True
        raise AssertionError("download must not run when over quota")

    def spy_extract(video_path, dest_path):
        called["extract"] = True
        raise AssertionError("extract must not run when over quota")

    monkeypatch.setattr(video_fetch, "download_video", spy_download)
    monkeypatch.setattr(audio_extract, "extract_audio", spy_extract)

    blocked = await _post_job(client, "user-fast", "lec-1")
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "lecture_quota_reached"
    assert called == {"download": False, "extract": False}


async def test_rewatch_does_not_consume_quota(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 1)
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: "hash-rewatch")

    first = await _post_job(client, "user-B", "lec-X")
    assert first.status_code == 200
    # same lecture again — allowed, no new slot used
    again = await _post_job(client, "user-B", "lec-X")
    assert again.status_code == 200
    # a different lecture is now over the limit of 1
    other = await _post_job(client, "user-B", "lec-Y")
    assert other.status_code == 403


async def test_review_grants_bonus(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 2)
    monkeypatch.setattr(settings, "review_bonus_lectures", 2)
    counter = {"n": 0}
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: f"h{(counter.__setitem__('n', counter['n'] + 1) or counter['n'])}")

    assert (await _post_job(client, "user-C", "l0")).status_code == 200
    assert (await _post_job(client, "user-C", "l1")).status_code == 200
    assert (await _post_job(client, "user-C", "l2")).status_code == 403  # base limit hit

    review = await client.post("/users/user-C/review")
    assert review.status_code == 200
    assert review.json() == {"used": 2, "limit": 4, "reviewed": True, "referral_credits": 0, "unlimited": False}

    # Reviewing again must NOT stack — the bonus is granted only once.
    again = await client.post("/users/user-C/review")
    assert again.json()["limit"] == 4

    assert (await _post_job(client, "user-C", "l2")).status_code == 200  # bonus unlocked


async def test_cache_hit_is_free_and_flagged(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 1)
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: "cached-hash")

    # Pre-seed the shared cache as if another student already transcribed this audio.
    async with SessionLocal() as session:
        await dedup.save_transcript(session, "cached-hash", "txt", "srt", "he")
        await session.commit()

    resp = await _post_job(client, "user-D", "popular-lecture")
    assert resp.status_code == 200
    assert resp.json()["from_cache"] is True

    # It did not cost a credit, so the user can still transcribe a real (new) lecture.
    usage = (await client.get("/users/user-D/usage")).json()
    assert usage["used"] == 0


async def test_usage_endpoint_and_ungated_without_user(client, monkeypatch):
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: "hash-ungated")

    # no user_id -> not gated at all
    resp = await client.post("/jobs", json={"video_url": "https://example.com/x.mp4"})
    assert resp.status_code == 200

    usage = await client.get("/users/fresh-user/usage")
    assert usage.json() == {
        "used": 0,
        "limit": settings.base_lecture_quota,
        "reviewed": False,
        "referral_credits": 0,
        "unlimited": False,
    }


async def test_referral_bonus_credits_both_accounts(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 5)
    monkeypatch.setattr(settings, "review_bonus_lectures", 5)
    monkeypatch.setattr(settings, "referral_bonus_lectures", 3)

    # The inviter reviews first and registers their username.
    inviter = await client.post("/users/user-inviter/review", json={"username": "leonovt"})
    assert inviter.json()["limit"] == 10  # base 5 + review bonus 5

    # The invitee reviews and names the inviter — both get +3.
    invitee = await client.post(
        "/users/user-invitee/review", json={"username": "newbie", "referred_by": "leonovt"}
    )
    assert invitee.json()["limit"] == 13  # base 5 + review bonus 5 + referral 3

    inviter_usage = (await client.get("/users/user-inviter/usage")).json()
    assert inviter_usage["limit"] == 13  # +3 referral credit for being named


async def test_referral_bonus_is_claimed_once(client, monkeypatch):
    monkeypatch.setattr(settings, "referral_bonus_lectures", 3)
    await client.post("/users/ref-inviter/review", json={"username": "ref-host"})

    first = await client.post(
        "/users/ref-invitee/review", json={"username": "ref-guest", "referred_by": "ref-host"}
    )
    second = await client.post(
        "/users/ref-invitee/review", json={"username": "ref-guest", "referred_by": "ref-host"}
    )
    assert first.json()["referral_credits"] == second.json()["referral_credits"] == 3


async def test_self_referral_is_ignored(client, monkeypatch):
    monkeypatch.setattr(settings, "referral_bonus_lectures", 3)
    resp = await client.post(
        "/users/self-ref-user/review", json={"username": "loopy", "referred_by": "loopy"}
    )
    assert resp.json()["referral_credits"] == 0


async def test_allowlisted_username_unlocks_unlimited_quota(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 1)
    monkeypatch.setattr(settings, "unlimited_usernames", {"leonovt"})
    counter = {"n": 0}
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: (counter.__setitem__("n", counter["n"] + 1), f"h{counter['n']}")[1])

    register = await client.post("/users/user-unlim/review", json={"username": "leonovt"})
    assert register.status_code == 200
    assert register.json()["unlimited"] is True

    for i in range(5):
        resp = await _post_job(client, "user-unlim", f"lec-{i}")
        assert resp.status_code == 200  # never quota-gated, well past base_lecture_quota=1


async def test_unregistered_username_changes_nothing(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 1)
    monkeypatch.setattr(settings, "review_bonus_lectures", 0)
    monkeypatch.setattr(settings, "unlimited_usernames", {"leonovt"})
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: "h-not-allowlisted")

    register = await client.post("/users/user-plain/review", json={"username": "someone-else"})
    assert register.json()["unlimited"] is False

    assert (await _post_job(client, "user-plain", "lec-0")).status_code == 200
    assert (await _post_job(client, "user-plain", "lec-1")).status_code == 403


async def test_allowlisted_user_id_unlocks_unlimited_quota_with_no_prompt(client, monkeypatch):
    monkeypatch.setattr(settings, "base_lecture_quota", 1)
    monkeypatch.setattr(settings, "unlimited_user_ids", {"moodle:439866"})
    counter = {"n": 0}
    monkeypatch.setattr(audio_extract, "hash_audio", lambda _p: (counter.__setitem__("n", counter["n"] + 1), f"h{counter['n']}")[1])

    # No /username registration at all — matched purely on the numeric id.
    usage = (await client.get("/users/moodle:439866/usage")).json()
    assert usage["unlimited"] is True

    for i in range(5):
        resp = await _post_job(client, "moodle:439866", f"lec-{i}")
        assert resp.status_code == 200  # never quota-gated, well past base_lecture_quota=1
