"""Abstract port interface for password hashing and token services."""

from abc import ABC, abstractmethod
from datetime import timedelta
from typing import Any


class PasswordHasher(ABC):
    """Abstract port for password hashing and verification."""

    @abstractmethod
    def hash_password(self, password: str) -> str:
        """Hash a plaintext password string."""
        raise NotImplementedError

    @abstractmethod
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a plaintext password against a hash."""
        raise NotImplementedError


class TokenService(ABC):
    """Abstract port for generating and validating authentication tokens."""

    @abstractmethod
    def create_token(
        self,
        subject: str,
        role: str,
        extra_claims: dict[str, Any] | None = None,
        expires_delta: timedelta | None = None,
    ) -> str:
        """Generate a signed access token string."""
        raise NotImplementedError

    @abstractmethod
    def decode_token(self, token: str) -> dict[str, Any]:
        """Decode and validate a signed access token."""
        raise NotImplementedError
