"""API v1 endpoints package."""

from backend.api.v1.endpoints.auth import router as auth_router
from backend.api.v1.endpoints.health import router as health_router

__all__ = ["auth_router", "health_router"]
