"""Database connection and async session management infrastructure.

Supports Supabase PostgreSQL (via asyncpg) and SQLite (via aiosqlite) for local testing.
"""

import ssl
from collections.abc import AsyncGenerator
from typing import Any
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from backend.core.config import settings


def _build_engine() -> AsyncEngine:
    """Build and configure the SQLAlchemy AsyncEngine based on environment."""

    # Use the property that guarantees async driver prefix
    db_url = settings.get_async_database_url

    is_sqlite = db_url.startswith("sqlite")
    is_postgres = db_url.startswith("postgresql")

    kwargs: dict[str, Any] = {
        "echo": settings.DEBUG and not is_sqlite,  # Don't echo SQLite by default to keep logs clean
    }

    connect_args: dict[str, Any] = {}

    if is_sqlite:
        connect_args["check_same_thread"] = False
        kwargs["poolclass"] = NullPool

    if is_postgres:
        # Connection pool tuning for Supabase / PostgreSQL
        kwargs.update({
            "pool_size": settings.DB_POOL_SIZE,
            "max_overflow": settings.DB_MAX_OVERFLOW,
            "pool_recycle": settings.DB_POOL_RECYCLE,
            "pool_pre_ping": True,
        })

        # Required for Supabase Transaction Pooler (Port 6543)
        # asyncpg param:
        connect_args["statement_cache_size"] = 0

        # Disable server-side cursors in transaction pool mode
        connect_args["server_settings"] = {"statement_timeout": "60000"}

        # SSL configuration for Supabase (requires SSL connections)
        if settings.DB_SSL_REQUIRED:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            connect_args["ssl"] = ssl_context

    if connect_args:
        kwargs["connect_args"] = connect_args

    return create_async_engine(db_url, **kwargs)


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


async def inicializar_red_logistica() -> dict | None:
    """Initialize or refresh the pgRouting logistics network topology in PostgreSQL."""
    from sqlalchemy import text
    import logging

    logger = logging.getLogger(__name__)

    try:
        async with engine.begin() as conn:
            if conn.dialect.name == "postgresql":
                result = await conn.execute(text("SELECT inicializar_red_logistica();"))
                val = result.scalar()
                logger.info(f"Red logística inicializada con éxito: {val}")
                return val
    except Exception as exc:
        logger.warning(f"inicializar_red_logistica no ejecutado o pendiente de migración pgrouting.sql: {exc}")
    return None
