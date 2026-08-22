"""Persistence repositories package."""

from backend.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository

__all__ = ["SQLAlchemyUserRepository"]
