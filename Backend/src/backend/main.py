"""Main FastAPI application entry point with lifespan, middleware, and OpenAPI metadata."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.api.v1.router import api_router
from backend.core.config import settings
from backend.core.exception_handlers import register_exception_handlers
from backend.infrastructure.cache import connect_cache, disconnect_cache
from backend.infrastructure.database import inicializar_red_logistica, init_db

log = logging.getLogger(__name__)

# OpenAPI metadata description and tags definition
TAGS_METADATA = [
    {
        "name": "Health & Monitoring",
        "description": "Endpoints for checking system health, connectivity, and database availability.",
    },
    {
        "name": "Authentication & RBAC",
        "description": "User authentication, JWT token generation, user registration, and Role-Based Access Control (RBAC).",
    },
]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifecycle manager for startup and shutdown events."""
    # Startup: initialize database tables and logistics network
    await init_db()
    await inicializar_red_logistica()
    # Redis Stack (docker-compose.yml en la raíz). connect_cache() nunca lanza:
    # si Redis no está disponible, loguea un warning y la API sigue funcionando
    # sin caché (degradación suave) -- ver infrastructure/cache.py.
    await connect_cache()

    # Sincronizar inventario y necesidades pendientes a Redis (DB 2, colaboración).
    # Sin esto el algoritmo greedy no ve stock y no genera asignaciones.
    # Si Redis no está disponible, se omite sin romper el arranque.
    try:
        from backend.collaboration.sync import sync_inventario_to_redis, sync_pending_needs_to_redis
        from backend.collaboration.tasks import get_redis
        from backend.infrastructure.database import async_session_maker

        r = get_redis()
        async with async_session_maker() as db:
            n_inv = await sync_inventario_to_redis(db, r)
            n_needs = await sync_pending_needs_to_redis(db, r)
        log.info("Redis colaboración sync: %d inventario, %d necesidades pendientes", n_inv, n_needs)
    except Exception as exc:
        log.warning("Redis colaboración sync omitido (Redis no disponible?): %s", exc)

    yield
    # Shutdown: cierra la conexión a Redis limpiamente si llegó a abrirse.
    await disconnect_cache()


def create_application() -> FastAPI:
    """Application factory initializing FastAPI with configurations and middlewares."""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        description="""
# PULSE API (Plataforma de Unificación y Lógica de Seguridad en Emergencias)

API backend con arquitectura hexagonal para la gestión de incidentes, publicaciones oficiales y autenticación con control de acceso basado en roles (RBAC).

## Características principales:
- **Arquitectura Hexagonal (Puertos y Adaptadores)**: Capa de dominio pura sin dependencias de frameworks ni ORMs, desacoplada mediante puertos abstractos.
- **Autenticación JWT y RBAC**: Roles diferenciados (`ADMIN_GUBERNAMENTAL`, `OPERADOR_CAMPO`, `ENTE_PUBLICO`, `CIVIL`).
- **Esquemas OpenAPI Estructurados**: Diseñados para integración con Next.js y consumo por Agentes de Inteligencia Artificial (Tool Calling).
- **Persistencia Asíncrona**: Motor SQLAlchemy 2.0 async con repositorio desacoplado.
        """,
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        contact={
            "name": "PULSE Development Team",
            "email": "soporte@sogr.gov.co",
        },
        license_info={
            "name": "MIT",
        },
    )

    # CORS Middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Global Exception Handlers
    register_exception_handlers(app)

    # Include API Routers
    app.include_router(api_router, prefix=settings.API_V1_STR)

    @app.get("/", tags=["Health & Monitoring"], summary="Root Welcome")
    async def root() -> dict[str, str]:
        """Root welcome endpoint providing pointers to documentation and API version."""
        return {
            "message": f"Welcome to {settings.PROJECT_NAME}",
            "version": settings.VERSION,
            "docs": "/docs",
            "openapi": "/openapi.json",
            "api_v1": settings.API_V1_STR,
        }

    return app


app = create_application()


def main() -> None:
    """CLI runner for development execution."""
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )


if __name__ == "__main__":
    main()
