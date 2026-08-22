"""Endpoints for user directory, registration of Entes Públicos, and status management."""

from collections.abc import Sequence
from typing import Optional
import uuid
from fastapi import APIRouter, status

from backend.api.deps import AuthServiceDep, RequireAdmin
from backend.domain.entities.user import UserRole
from backend.schemas.user import UserCreate, UserResponse, UserUpdate

router = APIRouter(prefix="/users", tags=["Users & Directory"])


@router.get(
    "",
    response_model=list[UserResponse],
    summary="List Users",
    description="Retrieves a list of registered users, optionally filtered by RBAC role (e.g. ENTE_PUBLICO for assigning responsible authorities to nodes).",
    status_code=status.HTTP_200_OK,
)
async def list_users(
    auth_service: AuthServiceDep,
    role: Optional[UserRole] = None,
) -> Sequence[UserResponse]:
    """Retrieve users, optionally filtered by role."""
    role_val = role.value if role else None
    users = await auth_service.list_users(role=role_val)
    return [UserResponse.model_validate(u) for u in users]


@router.post(
    "",
    response_model=UserResponse,
    summary="Create User (Admin only)",
    description="Allows ADMIN_GUBERNAMENTAL to register and enable new institutional users (e.g. ENTE_PUBLICO).",
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    payload: UserCreate,
    auth_service: AuthServiceDep,
    _admin: RequireAdmin,
) -> UserResponse:
    """Create a new user account (Admin exclusive)."""
    user = await auth_service.register_user(
        email=payload.email,
        plain_password=payload.password,
        role=payload.role,
    )
    return UserResponse.model_validate(user)


@router.patch(
    "/{user_id}/status",
    response_model=UserResponse,
    summary="Toggle User Active Status (Admin only)",
    description="Enables or disables an institutional user account (e.g. ENTE_PUBLICO).",
    status_code=status.HTTP_200_OK,
)
async def update_user_status(
    user_id: uuid.UUID,
    payload: UserUpdate,
    auth_service: AuthServiceDep,
    _admin: RequireAdmin,
) -> UserResponse:
    """Toggle user active status (Admin exclusive)."""
    is_active = payload.is_active if payload.is_active is not None else True
    user = await auth_service.update_user_status(user_id=user_id, is_active=is_active)
    return UserResponse.model_validate(user)
