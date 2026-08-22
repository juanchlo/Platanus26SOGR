"""SQLAlchemy ORM model for User with entity mappers."""

from sqlalchemy import Boolean, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.domain.entities.user import UserEntity, UserRole
from backend.infrastructure.persistence.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserModel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Database ORM mapping for the 'users' table."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )
    hashed_password: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role_enum", native_enum=False),
        default=UserRole.CIVIL,
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    def to_entity(self) -> UserEntity:
        """Map ORM database model to pure domain UserEntity."""
        return UserEntity(
            id=self.id,
            email=self.email,
            hashed_password=self.hashed_password,
            role=self.role,
            is_active=self.is_active,
            created_at=self.created_at,
            updated_at=self.updated_at,
        )

    @classmethod
    def from_entity(cls, entity: UserEntity) -> "UserModel":
        """Instantiate ORM model from a pure domain UserEntity."""
        return cls(
            id=entity.id,
            email=entity.email,
            hashed_password=entity.hashed_password,
            role=entity.role,
            is_active=entity.is_active,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )
