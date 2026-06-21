from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.models import Base

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# SQLite (used in tests) ignores foreign keys unless asked to enforce them, which once
# let an invalid FK ship to Postgres. Turn it on so tests mirror production constraints.
if engine.dialect.name == "sqlite":

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all won't add new columns to a table that already exists, so additive
        # columns need a nudge on existing deployments. Postgres-only (SQLite tests start
        # fresh, and its ADD COLUMN has no IF NOT EXISTS).
        if engine.dialect.name == "postgresql":
            await conn.exec_driver_sql(
                "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS provider VARCHAR(16)"
            )
            await conn.exec_driver_sql(
                "ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS username VARCHAR(128)"
            )
            await conn.exec_driver_sql(
                "ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS referred_by VARCHAR(128)"
            )
            await conn.exec_driver_sql(
                "ALTER TABLE user_rewards ADD COLUMN IF NOT EXISTS referral_credits INTEGER NOT NULL DEFAULT 0"
            )
            await conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_user_rewards_username ON user_rewards (username)"
            )


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
