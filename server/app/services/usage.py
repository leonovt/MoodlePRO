from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import UserLecture, UserReward


async def _count_lectures(session: AsyncSession, user_id: str) -> int:
    return await session.scalar(
        select(func.count()).select_from(UserLecture).where(UserLecture.user_id == user_id)
    ) or 0


async def _limit_for(session: AsyncSession, user_id: str) -> int:
    reward = await session.get(UserReward, user_id)
    bonus = settings.review_bonus_lectures if (reward and reward.reviewed) else 0
    referral_credits = reward.referral_credits if reward else 0
    return settings.base_lecture_quota + bonus + referral_credits


def _is_unlimited(reward: UserReward | None) -> bool:
    if not reward or not reward.username:
        return False
    return reward.username.lower() in {u.lower() for u in settings.unlimited_usernames}


async def check_and_reserve(session: AsyncSession, user_id: str, lecture_key: str) -> bool:
    """Reserve a quota slot for (user, lecture). Returns True if allowed.

    Re-watching an already-counted lecture is always allowed and doesn't consume a new
    slot. A brand-new lecture consumes a slot only if the user is under their limit, or
    unconditionally if the user is on the unlimited allowlist.
    """
    existing = await session.get(UserLecture, {"user_id": user_id, "lecture_key": lecture_key})
    if existing is not None:
        return True  # already counted — re-watch is free

    reward = await session.get(UserReward, user_id)
    unlimited = _is_unlimited(reward)
    if not unlimited and await _count_lectures(session, user_id) >= await _limit_for(session, user_id):
        return False

    session.add(UserLecture(user_id=user_id, lecture_key=lecture_key))
    await session.commit()
    return True


async def grant_review_bonus(
    session: AsyncSession, user_id: str, username: str | None = None, referred_by: str | None = None
) -> None:
    """Mark the user as having reviewed (honor system), unlocking the bonus lectures.

    If `username` is given, it's stored so other users can name this account as their
    referrer later. If `referred_by` is given (and not the user's own username), both
    this account and the named referrer each get a one-time referral_bonus_lectures
    credit — claimed only once per account, on either side.
    """
    reward = await session.get(UserReward, user_id)
    if reward is None:
        reward = UserReward(user_id=user_id, referral_credits=0)
        session.add(reward)
    reward.reviewed = True
    if username:
        reward.username = username

    if referred_by and not reward.referred_by and referred_by != (username or user_id):
        reward.referred_by = referred_by
        reward.referral_credits += settings.referral_bonus_lectures

        referrer = await session.scalar(select(UserReward).where(UserReward.username == referred_by))
        if referrer and referrer.user_id != user_id:
            referrer.referral_credits += settings.referral_bonus_lectures

    await session.commit()


async def set_username(session: AsyncSession, user_id: str, username: str) -> None:
    """Register a self-reported Moodle username, independent of leaving a review.

    Used to bootstrap the unlimited-quota allowlist before a user has ever hit the
    quota/review prompt. Must NOT mark the account as reviewed or grant a review bonus.
    """
    reward = await session.get(UserReward, user_id)
    if reward is None:
        reward = UserReward(user_id=user_id, referral_credits=0)
        session.add(reward)
    reward.username = username
    await session.commit()


async def get_usage(session: AsyncSession, user_id: str) -> dict:
    reward = await session.get(UserReward, user_id)
    return {
        "used": await _count_lectures(session, user_id),
        "limit": await _limit_for(session, user_id),
        "reviewed": bool(reward and reward.reviewed),
        "referral_credits": reward.referral_credits if reward else 0,
        "unlimited": _is_unlimited(reward),
    }
