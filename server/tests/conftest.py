import os
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

_tmp_dir = tempfile.mkdtemp(prefix="moodlepro-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp_dir}/test.db"
os.environ["STORAGE_DIR"] = str(Path(_tmp_dir) / "storage")
os.environ["INTERNAL_API_TOKEN"] = "test-internal-token"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"

import fakeredis.aioredis as fakeredis_aio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app import main as app_main  # noqa: E402
from app.api import internal as api_internal  # noqa: E402
from app.api import jobs as api_jobs  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def patch_redis(monkeypatch):
    """Swap the real Redis class for fakeredis everywhere the app constructs a client.

    All FakeRedis.from_url(...) calls share the same in-memory server (keyed by URL),
    so the queue/pubsub behave like a single real Redis instance across the test.
    """
    monkeypatch.setattr(api_jobs, "Redis", fakeredis_aio.FakeRedis)
    monkeypatch.setattr(api_internal, "Redis", fakeredis_aio.FakeRedis)
    monkeypatch.setattr(app_main, "Redis", fakeredis_aio.FakeRedis)


@pytest_asyncio.fixture
async def client():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest.fixture
def internal_headers():
    return {"Authorization": f"Bearer {os.environ['INTERNAL_API_TOKEN']}"}
