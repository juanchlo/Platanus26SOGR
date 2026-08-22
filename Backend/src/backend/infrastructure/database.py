"""Database connection and async session management infrastructure.

Supports Supabase PostgreSQL (via asyncpg) and SQLite (via aiosqlite) for local testing.
"""

import ssl
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from backend.core.config import settings


def _build_engine() -> AsyncEngine:
    """Build the SQLAlchemy async engine with driver-appropriate settings."""
    is_postgres = settings.DATABASE_URL.startswith("postgresql")

    connect_args: dict = {}
    kwargs: dict = {
        "echo": settings.DEBUG and settings.ENVIRONMENT == "development",
        "future": True,
    }

    if is_postgres:
        # Connection pool tuning for Supabase / PostgreSQL
        kwargs.update({
            "pool_size": settings.DB_POOL_SIZE,
            "max_overflow": settings.DB_MAX_OVERFLOW,
            "pool_recycle": settings.DB_POOL_RECYCLE,
            "pool_pre_ping": True,
        })

        # SSL configuration for Supabase (requires SSL connections)
        if settings.DB_SSL_REQUIRED:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            connect_args["ssl"] = ssl_context

    if connect_args:
        kwargs["connect_args"] = connect_args

    return create_async_engine(settings.DATABASE_URL, **kwargs)


# Database Engine
engine: AsyncEngine = _build_engine()

# Async session factory
async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Provide an async database session for the request lifecycle."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database tables for all registered models."""
    from backend.infrastructure.persistence.models.base import Base
    import backend.infrastructure.persistence.models.punto_control  # noqa: F401
    import backend.infrastructure.persistence.models.user  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
