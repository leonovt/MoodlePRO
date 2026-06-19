from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Job


async def get_job_or_404(session: AsyncSession, job_id: str) -> Job:
    job = await session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
