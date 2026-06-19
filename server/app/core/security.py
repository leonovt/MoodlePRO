from fastapi import Header, HTTPException, status

from app.core.config import settings


async def require_internal_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {settings.internal_api_token}"
    if authorization != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
