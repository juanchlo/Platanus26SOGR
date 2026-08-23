"""Application configuration settings using pydantic-settings."""

import json
import os
from pathlib import Path
from typing import Any
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent.parent

def parse_cors_origins(v: Any) -> list[str]:
    """Parse CORS origins from JSON list, comma-separated string, or asterisk."""
    if isinstance(v, str):
        if not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        try:
            parsed = json.loads(v)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
        return [v]
    elif isinstance(v, list):
        return v
    return ["*"]


class Settings(BaseSettings):
    """Global configuration settings for the backend API."""

    model_config = SettingsConfigDict(
        env_file=os.path.join(BACKEND_DIR, ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # General
    PROJECT_NAME: str = "PULSE API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database (Supabase PostgreSQL or SQLite for local dev/testing)
    DATABASE_URL: str = "sqlite+aiosqlite:///./sogr.db"

    @property
    def get_async_database_url(self) -> str:
        """Automatically ensure the URL uses the asyncpg driver if postgresql is specified."""
        if self.DATABASE_URL.startswith("postgresql://"):
            return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif self.DATABASE_URL.startswith("postgres://"):
            return self.DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
        return self.DATABASE_URL

    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_RECYCLE: int = 300
    DB_SSL_REQUIRED: bool = True

    # Caché — Redis Stack (docker-compose.yml en la raíz del repo).
    # Ver docs/PLAN_MASTER_OPTIMIZACION.md, sección 4.4 (estrategia de caching).
    REDIS_URL: str = "redis://localhost:6379/0"
    CACHE_ENABLED: bool = True

    # TTLs por endpoint, en segundos. Valores dentro de los rangos recomendados
    # en el plan maestro; ver infrastructure/cache.py para dónde se aplican.
    CACHE_TTL_CIUDAD_ESTADO: int = 20  # R-06: endpoint más costoso, más invocado por el agente
    CACHE_TTL_PUNTOS_CONTROL: int = 60
    CACHE_TTL_NODOS_AFECTADOS_TRIAGE: int = 12
    CACHE_TTL_ALERTAS_NODOS_INACTIVOS: int = 60
    CACHE_TTL_INSUMOS_CATALOGO: int = 3600
    CACHE_TTL_RESOLVER_INSUMO: int = 3600

    # Security / JWT
    JWT_SECRET_KEY: str = "insecure-default-jwt-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    # CORS
    CORS_ORIGINS: list[str] | str = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    @field_validator("CORS_ORIGINS", mode="after")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> list[str]:
        return parse_cors_origins(v)

    # AI & Audio Services
    ELEVENLABS_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    CLAUDE_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None


settings = Settings()
