"""Abstract port interface for User persistence operations."""

from abc import ABC, abstractmethod
import uuid

from backend.domain.entities.user import UserEntity


class UserRepository(ABC):
    """Abstract port defining storage and retrieval contract for User entities."""

    @abstractmethod
    async def get_by_id(self, user_id: uuid.UUID) -> UserEntity | None:
        """Retrieve a User by unique ID."""
        raise NotImplementedError

    @abstractmethod
    async def get_by_email(self, email: str) -> UserEntity | None:
        """Retrieve a User by unique email address."""
        raise NotImplementedError

    @abstractmethod
    async def create(self, user: UserEntity) -> UserEntity:
        """Persist a new User entity."""
        raise NotImplementedError

    @abstractmethod
    async def update(self, user: UserEntity) -> UserEntity:
        """Update an existing User entity."""
        raise NotImplementedError
