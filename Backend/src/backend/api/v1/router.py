"""API v1 root router aggregating all domain sub-routers."""

from fastapi import APIRouter

from backend.api.v1.endpoints.auth import router as auth_router
from backend.api.v1.endpoints.health import router as health_router
from backend.api.v1.endpoints.puntos_control import router as puntos_control_router
from backend.api.v1.endpoints.users import router as users_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(puntos_control_router)
api_router.include_router(users_router)

