"""API v1 root router aggregating all domain sub-routers."""

from fastapi import APIRouter

from backend.api.v1.endpoints.alertas import router as alertas_router
from backend.api.v1.endpoints.auth import router as auth_router
from backend.api.v1.endpoints.ciudad import router as ciudad_router
from backend.api.v1.endpoints.health import router as health_router
from backend.api.v1.endpoints.incidentes import router as incidentes_router
from backend.api.v1.endpoints.insumos import router as insumos_router
from backend.api.v1.endpoints.nodos_afectados import router as nodos_afectados_router
from backend.api.v1.endpoints.puntos_control import router as puntos_control_router
from backend.api.v1.endpoints.recursos import router as recursos_router
from backend.api.v1.endpoints.users import router as users_router

api_router = APIRouter()

api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(puntos_control_router)
api_router.include_router(users_router)
api_router.include_router(insumos_router)
api_router.include_router(alertas_router)
api_router.include_router(incidentes_router)
api_router.include_router(nodos_afectados_router)
api_router.include_router(recursos_router)
api_router.include_router(ciudad_router)
