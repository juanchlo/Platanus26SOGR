"""Domain entities and value objects. Pure Python with zero framework dependencies."""

from dataclasses import dataclass
from datetime import datetime, timezone
import enum
import uuid


class UserRole(str, enum.Enum):
    """Enumeration of user roles for Role-Based Access Control (RBAC)."""

    ADMIN_GUBERNAMENTAL = "ADMIN_GUBERNAMENTAL"
    OPERADOR_CAMPO = "OPERADOR_CAMPO"
    ENTE_PUBLICO = "ENTE_PUBLICO"
    CIVIL = "CIVIL"


@dataclass
class UserEntity:
    """Core domain entity representing a User."""

    id: uuid.UUID
    email: str
    hashed_password: str
    role: UserRole
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @classmethod
    def create_new(
        cls,
        email: str,
        hashed_password: str,
        role: UserRole = UserRole.CIVIL,
        is_active: bool = True,
    ) -> "UserEntity":
        """Factory method to instantiate a new domain user entity."""
        now = datetime.now(timezone.utc)
        return cls(
            id=uuid.uuid4(),
            email=email.lower().strip(),
            hashed_password=hashed_password,
            role=role,
            is_active=is_active,
            created_at=now,
            updated_at=now,
        )
