"""Health check and status monitoring endpoints."""

from typing import Any
from fastapi import APIRouter, Depends, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.infrastructure.database import get_db

router = APIRouter(prefix="/health", tags=["Health & Monitoring"])


@router.get(
    "",
    summary="Health Check",
    description="Returns the current operational status of the API service and its database connection.",
    status_code=status.HTTP_200_OK,
    response_model=dict[str, Any],
)
async def health_check(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Verify backend connectivity and database health."""
    db_status = "connected"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        db_status = f"unhealthy: {exc!s}"

    dialect = db.bind.dialect.name if db.bind else "unknown"
    return {
        "status": "ok" if db_status == "connected" else "degraded",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "database": db_status,
        "database_type": dialect,
    }
