from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas import ReviewClaimRequest, UsageResponse, UsernameRequest
from app.services import usage

router = APIRouter(prefix="/users")


@router.get("/{user_id}/usage", response_model=UsageResponse)
async def get_user_usage(
    user_id: str, session: AsyncSession = Depends(get_session)
) -> UsageResponse:
    return UsageResponse(**await usage.get_usage(session, user_id))


@router.post("/{user_id}/review", response_model=UsageResponse)
async def claim_review_bonus(
    user_id: str, body: ReviewClaimRequest = ReviewClaimRequest(), session: AsyncSession = Depends(get_session)
) -> UsageResponse:
    """Honor system: grant the review bonus (plus a referral bonus if named), then
    return the updated usage."""
    await usage.grant_review_bonus(session, user_id, username=body.username, referred_by=body.referred_by)
    return UsageResponse(**await usage.get_usage(session, user_id))


@router.post("/{user_id}/username", response_model=UsageResponse)
async def register_username(
    user_id: str, body: UsernameRequest, session: AsyncSession = Depends(get_session)
) -> UsageResponse:
    """Register a self-reported Moodle username (honor system), independent of leaving a
    review — used to bootstrap the unlimited-quota allowlist."""
    await usage.set_username(session, user_id, body.username)
    return UsageResponse(**await usage.get_usage(session, user_id))
