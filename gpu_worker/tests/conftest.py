import os
import sys
import tempfile
from pathlib import Path

import pytest

_THIS_DIR = Path(__file__).resolve().parent
_WORKER_DIR = _THIS_DIR.parent
_SERVER_DIR = _WORKER_DIR.parent / "server"

sys.path.insert(0, str(_WORKER_DIR))
sys.path.insert(0, str(_SERVER_DIR))

_tmp_dir = tempfile.mkdtemp(prefix="moodlepro-worker-test-")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp_dir}/test.db"
os.environ["STORAGE_DIR"] = str(Path(_tmp_dir) / "storage")
os.environ["INTERNAL_API_TOKEN"] = "test-internal-token"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"

import fakeredis.aioredis as fakeredis_aio  # noqa: E402

from app.api import internal as api_internal  # noqa: E402
from app.api import jobs as api_jobs  # noqa: E402
from app import main as app_main  # noqa: E402


@pytest.fixture(autouse=True)
def patch_server_redis(monkeypatch):
    monkeypatch.setattr(api_jobs, "Redis", fakeredis_aio.FakeRedis)
    monkeypatch.setattr(api_internal, "Redis", fakeredis_aio.FakeRedis)
    monkeypatch.setattr(app_main, "Redis", fakeredis_aio.FakeRedis)


@pytest.fixture
def fake_redis():
    return fakeredis_aio.FakeRedis.from_url(os.environ["REDIS_URL"])
