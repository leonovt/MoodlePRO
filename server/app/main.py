import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from app.api import internal, jobs, ws
from app.core.config import settings
from app.db.session import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    redis = Redis.from_url(settings.redis_url)
    relay_task = asyncio.create_task(ws.relay_segments_forever(redis))
    try:
        yield
    finally:
        relay_task.cancel()
        await redis.aclose()


app = FastAPI(title="MoodlePRO Processing Server", lifespan=lifespan)

app.include_router(jobs.router)
app.include_router(internal.router)
app.include_router(ws.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
