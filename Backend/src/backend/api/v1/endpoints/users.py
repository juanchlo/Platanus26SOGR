"""Endpoints for user directory and role lookups."""

from collections.abc import Sequence
from typing import Optional
from fastapi import APIRouter, status

from backend.api.deps import AuthServiceDep
from backend.domain.entities.user import UserRole
from backend.schemas.user import UserResponse

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
