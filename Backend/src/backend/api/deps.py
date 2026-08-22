"""FastAPI dependency injection wiring domain ports to infrastructure adapters."""

from collections.abc import Sequence
from typing import Annotated
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import PyJWTError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.exceptions import ForbiddenException, UnauthorizedException
from backend.domain.entities.user import UserEntity, UserRole
from backend.domain.ports.security_service import PasswordHasher, TokenService
from backend.domain.ports.user_repository import UserRepository
from backend.domain.services.auth_service import AuthService
from backend.infrastructure.database import get_db
from backend.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from backend.infrastructure.security import password_hasher as default_hasher
from backend.infrastructure.security import token_service as default_token_service

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login/oauth",
    auto_error=False,
)

# Database Session Dependency
DatabaseSession = Annotated[AsyncSession, Depends(get_db)]


def get_user_repository(db: DatabaseSession) -> UserRepository:
    """Dependency providing a UserRepository port backed by SQLAlchemy adapter."""
    return SQLAlchemyUserRepository(db)


def get_password_hasher() -> PasswordHasher:
    """Dependency providing PasswordHasher port backed by Bcrypt adapter."""
    return default_hasher


def get_token_service() -> TokenService:
    """Dependency providing TokenService port backed by PyJWT adapter."""
    return default_token_service


def get_auth_service(
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    hasher: Annotated[PasswordHasher, Depends(get_password_hasher)],
) -> AuthService:
    """Dependency providing domain AuthService with injected repository and hasher ports."""
    return AuthService(user_repo=user_repo, password_hasher=hasher)


# Type aliases for injected domain ports and services
UserRepoDep = Annotated[UserRepository, Depends(get_user_repository)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
TokenServiceDep = Annotated[TokenService, Depends(get_token_service)]


async def get_current_user(
    auth_service: AuthServiceDep,
    token_service: TokenServiceDep,
    token: Annotated[str | None, Depends(oauth2_scheme)],
) -> UserEntity:
    """Extract, validate JWT Bearer token and retrieve the authenticated domain UserEntity."""
    if not token:
        raise UnauthorizedException("Missing authentication Bearer token.")

    try:
        payload = token_service.decode_token(token)
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise UnauthorizedException("Invalid token payload: missing subject.")
    except PyJWTError as exc:
        raise UnauthorizedException(f"Invalid or expired token: {exc!s}")

    user = await auth_service.get_by_id(user_id)
    if not user:
        raise UnauthorizedException("User not found.")

    if not user.is_active:
        raise UnauthorizedException("User account is inactive.")

    return user


class RoleChecker:
    """Dependency factory enforcing Role-Based Access Control on domain UserEntity."""

    def __init__(self, allowed_roles: Sequence[UserRole] | UserRole):
        if isinstance(allowed_roles, UserRole):
            self.allowed_roles = [allowed_roles]
        else:
            self.allowed_roles = list(allowed_roles)

    def __call__(
        self,
        current_user: Annotated[UserEntity, Depends(get_current_user)],
    ) -> UserEntity:
        if current_user.role not in self.allowed_roles:
            allowed_names = [role.value for role in self.allowed_roles]
            raise ForbiddenException(
                f"Insufficient permissions. Required one of roles: {allowed_names}, "
                f"but current user has role '{current_user.role.value}'."
            )
        return current_user


# Shortcut annotations
CurrentUser = Annotated[UserEntity, Depends(get_current_user)]
RequireAdmin = Annotated[UserEntity, Depends(RoleChecker([UserRole.ADMIN_GUBERNAMENTAL]))]
RequireFieldOperator = Annotated[UserEntity, Depends(RoleChecker([UserRole.ADMIN_GUBERNAMENTAL, UserRole.OPERADOR_CAMPO]))]
RequirePublicEntity = Annotated[UserEntity, Depends(RoleChecker([UserRole.ADMIN_GUBERNAMENTAL, UserRole.ENTE_PUBLICO]))]
