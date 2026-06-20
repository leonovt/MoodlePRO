import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis

from app.api import content, internal, jobs, ws
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://moodle.bgu.ac.il"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(internal.router)
app.include_router(ws.router)
app.include_router(content.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
