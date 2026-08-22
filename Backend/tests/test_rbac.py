"""Tests for RBAC RoleChecker dependency."""

import pytest
from fastapi import APIRouter, Depends
from httpx import AsyncClient

from backend.api.deps import RequireAdmin, RequireFieldOperator, RequirePublicEntity
from backend.domain.entities.user import UserEntity, UserRole
from backend.main import app

# Test router to verify role enforcement
rbac_test_router = APIRouter(prefix="/api/v1/test-rbac", tags=["Test RBAC"])


@rbac_test_router.get("/admin-only")
async def admin_only_endpoint(user: RequireAdmin) -> dict[str, str]:
    return {"role": user.role.value, "access": "granted"}


@rbac_test_router.get("/field-operator-or-admin")
async def field_operator_endpoint(user: RequireFieldOperator) -> dict[str, str]:
    return {"role": user.role.value, "access": "granted"}


@rbac_test_router.get("/public-entity-or-admin")
async def public_entity_endpoint(user: RequirePublicEntity) -> dict[str, str]:
    return {"role": user.role.value, "access": "granted"}


# Register temporary test router
app.include_router(rbac_test_router)


@pytest.mark.asyncio
async def test_rbac_admin_access(client: AsyncClient) -> None:
    """Test ADMIN role can access admin-only endpoint."""
    # Register Admin
    await client.post(
        "/api/v1/auth/register",
        json={"email": "superadmin@example.com", "password": "Pass123!", "role": UserRole.ADMIN_GUBERNAMENTAL.value},
    )
    login_res = await client.post(
        "/api/v1/auth/login",
        json={"email": "superadmin@example.com", "password": "Pass123!"},
    )
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.get("/api/v1/test-rbac/admin-only", headers=headers)
    assert res.status_code == 200
    assert res.json()["access"] == "granted"


@pytest.mark.asyncio
async def test_rbac_forbidden_for_civilian(client: AsyncClient) -> None:
    """Test CIVIL role gets 403 Forbidden on admin endpoint."""
    # Register Civil
    await client.post(
        "/api/v1/auth/register",
        json={"email": "civil@example.com", "password": "Pass123!", "role": UserRole.CIVIL.value},
    )
    login_res = await client.post(
        "/api/v1/auth/login",
        json={"email": "civil@example.com", "password": "Pass123!"},
    )
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.get("/api/v1/test-rbac/admin-only", headers=headers)
    assert res.status_code == 403
    data = res.json()
    assert data["success"] is False
    assert data["error"]["code"] == "FORBIDDEN"
