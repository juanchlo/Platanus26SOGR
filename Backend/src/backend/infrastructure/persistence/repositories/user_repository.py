"""SQLAlchemy repository implementation of the UserRepository domain port."""

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.entities.user import UserEntity
from backend.domain.ports.user_repository import UserRepository
from backend.infrastructure.persistence.models.user import UserModel


class SQLAlchemyUserRepository(UserRepository):
    """Outbound adapter implementing persistence for User entities with SQLAlchemy."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, user_id: uuid.UUID) -> UserEntity | None:
        """Fetch user by UUID from database and map to domain entity."""
        stmt = select(UserModel).where(UserModel.id == user_id)
        result = await self.session.execute(stmt)
        user_orm = result.scalar_one_or_none()
        return user_orm.to_entity() if user_orm else None

    async def get_by_email(self, email: str) -> UserEntity | None:
        """Fetch user by unique email from database and map to domain entity."""
        stmt = select(UserModel).where(UserModel.email == email.lower().strip())
        result = await self.session.execute(stmt)
        user_orm = result.scalar_one_or_none()
        return user_orm.to_entity() if user_orm else None

    async def create(self, user: UserEntity) -> UserEntity:
        """Persist a new user record in database."""
        user_orm = UserModel.from_entity(user)
        self.session.add(user_orm)
        await self.session.flush()
        await self.session.refresh(user_orm)
        return user_orm.to_entity()

    async def update(self, user: UserEntity) -> UserEntity:
        """Update an existing user record in database."""
        stmt = select(UserModel).where(UserModel.id == user.id)
        result = await self.session.execute(stmt)
        user_orm = result.scalar_one()

        user_orm.email = user.email
        user_orm.hashed_password = user.hashed_password
        user_orm.role = user.role
        user_orm.is_active = user.is_active

        await self.session.flush()
        await self.session.refresh(user_orm)
        return user_orm.to_entity()
