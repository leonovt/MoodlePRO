import asyncio

from fakeredis.aioredis import FakeRedis
from fastapi.testclient import TestClient

from app.main import app
from app.services.queue import publish_completed, publish_segment


def test_websocket_receives_segment_and_completion_events():
    with TestClient(app) as tc, tc.websocket_connect("/ws/jobs/job-42") as ws:
        async def _publish():
            redis = FakeRedis.from_url("redis://localhost:6379/0")
            await publish_segment(redis, "job-42", "Shalom", 0.0, 1.5)
            await publish_completed(redis, "job-42", "Shalom")

        asyncio.run(_publish())

        first = ws.receive_json()
        assert first == {"type": "segment", "job_id": "job-42", "text": "Shalom", "start": 0.0, "end": 1.5}

        second = ws.receive_json()
        assert second == {"type": "completed", "job_id": "job-42", "text": "Shalom"}
