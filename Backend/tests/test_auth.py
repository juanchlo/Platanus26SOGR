"""Tests for authentication, registration, JWT handling, and RBAC."""

import pytest
from httpx import AsyncClient

from backend.domain.entities.user import UserRole


@pytest.mark.asyncio
async def test_register_user(client: AsyncClient) -> None:
    """Test successful user registration."""
    payload = {
        "email": "nuevo@example.com",
        "password": "Password123!",
        "role": UserRole.CIVIL.value,
    }
    response = await client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "nuevo@example.com"
    assert data["role"] == UserRole.CIVIL.value
    assert data["is_active"] is True
    assert "id" in data


@pytest.mark.asyncio
async def test_register_duplicate_user(client: AsyncClient) -> None:
    """Test duplicate registration returns 409 Conflict."""
    payload = {
        "email": "duplicado@example.com",
        "password": "Password123!",
        "role": UserRole.CIVIL.value,
    }
    res1 = await client.post("/api/v1/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = await client.post("/api/v1/auth/register", json=payload)
    assert res2.status_code == 409
    data = res2.json()
    assert data["success"] is False
    assert data["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_login_success_and_get_me(client: AsyncClient) -> None:
    """Test login and accessing protected /me endpoint."""
    # 1. Register
    reg_payload = {
        "email": "admin@example.com",
        "password": "AdminPassword123!",
        "role": UserRole.ADMIN_GUBERNAMENTAL.value,
    }
    reg_res = await client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_res.status_code == 201

    # 2. Login
    login_payload = {
        "email": "admin@example.com",
        "password": "AdminPassword123!",
    }
    login_res = await client.post("/api/v1/auth/login", json=login_payload)
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"
    access_token = token_data["access_token"]

    # 3. Access /me
    headers = {"Authorization": f"Bearer {access_token}"}
    me_res = await client.get("/api/v1/auth/me", headers=headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == "admin@example.com"
    assert me_data["role"] == UserRole.ADMIN_GUBERNAMENTAL.value


@pytest.mark.asyncio
async def test_login_invalid_password(client: AsyncClient) -> None:
    """Test login with wrong password returns 401 Unauthorized."""
    # Register
    reg_payload = {
        "email": "user@example.com",
        "password": "CorrectPassword123!",
    }
    await client.post("/api/v1/auth/register", json=reg_payload)

    # Login wrong pass
    login_payload = {
        "email": "user@example.com",
        "password": "WrongPassword!",
    }
    res = await client.post("/api/v1/auth/login", json=login_payload)
    assert res.status_code == 401
    data = res.json()
    assert data["success"] is False
    assert data["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_access_me_unauthorized(client: AsyncClient) -> None:
    """Test accessing /me without token returns 401."""
    res = await client.get("/api/v1/auth/me")
    assert res.status_code == 401
