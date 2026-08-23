"""Application configuration settings using pydantic-settings."""

import json
import os
from pathlib import Path
from typing import Annotated, Any
from pydantic import BeforeValidator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent.parent

def parse_cors_origins(v: Any) -> list[str]:
    """Parse CORS origins from JSON list or comma-separated string."""
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, str) and v.startswith("["):
        try:
            return json.loads(v)
        except Exception:
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

    # Security / JWT
    JWT_SECRET_KEY: str = "insecure-default-jwt-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    # CORS
    CORS_ORIGINS: Annotated[list[str], BeforeValidator(parse_cors_origins)] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # AI & Audio Services
    ELEVENLABS_API_KEY: str | None = None
    ANTHROPIC_API_KEY: str | None = None
    CLAUDE_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None


settings = Settings()
