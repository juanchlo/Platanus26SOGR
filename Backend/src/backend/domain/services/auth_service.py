"""Domain Application Service for Authentication and User management."""

import uuid

from backend.core.exceptions import ConflictException, UnauthorizedException
from backend.domain.entities.user import UserEntity, UserRole
from backend.domain.ports.security_service import PasswordHasher
from backend.domain.ports.user_repository import UserRepository


class AuthService:
    """Application service coordinating authentication and user operations via abstract ports."""

    def __init__(
        self,
        user_repo: UserRepository,
        password_hasher: PasswordHasher,
    ) -> None:
        self.user_repo = user_repo
        self.password_hasher = password_hasher

    async def get_by_id(self, user_id: uuid.UUID | str) -> UserEntity | None:
        """Retrieve user entity by UUID or string representation."""
        if isinstance(user_id, str):
            try:
                user_id = uuid.UUID(user_id)
            except ValueError:
                return None
        return await self.user_repo.get_by_id(user_id)

    async def get_by_email(self, email: str) -> UserEntity | None:
        """Retrieve user entity by email address."""
        return await self.user_repo.get_by_email(email.lower().strip())

    async def register_user(
        self,
        email: str,
        plain_password: str,
        role: UserRole = UserRole.CIVIL,
    ) -> UserEntity:
        """Register a new user enforcing unique email constraint and password hashing."""
        clean_email = email.lower().strip()
        existing = await self.user_repo.get_by_email(clean_email)
        if existing:
            raise ConflictException(f"User with email '{email}' already exists.")

        hashed_password = self.password_hasher.hash_password(plain_password)
        new_user = UserEntity.create_new(
            email=clean_email,
            hashed_password=hashed_password,
            role=role,
            is_active=True,
        )
        return await self.user_repo.create(new_user)

    async def authenticate_user(
        self,
        email: str,
        plain_password: str,
    ) -> UserEntity:
        """Authenticate user credentials and verify account status."""
        user = await self.user_repo.get_by_email(email.lower().strip())
        if not user:
            raise UnauthorizedException("Invalid email or password.")

        if not self.password_hasher.verify_password(plain_password, user.hashed_password):
            raise UnauthorizedException("Invalid email or password.")

        if not user.is_active:
            raise UnauthorizedException("Inactive user account.")

        return user

    async def list_users(self, role: str | None = None) -> list[UserEntity]:
        """List all users optionally filtered by role."""
        return await self.user_repo.list_all(role=role)

    async def update_user_status(self, user_id: uuid.UUID, is_active: bool) -> UserEntity:
        """Update active/inactive status of a user account."""
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundException(f"User with ID {user_id} not found.")
        user.is_active = is_active
        return await self.user_repo.update(user)


