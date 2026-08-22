"""Integration tests for Puntos de Control (Nodos) endpoints and RBAC creation rules."""

from datetime import timedelta
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.entities.user import UserEntity, UserRole
from backend.infrastructure.persistence.models.user import UserModel
from backend.infrastructure.security import password_hasher, token_service


@pytest.mark.asyncio
async def test_admin_can_create_punto_control_with_ente_publico_responsable(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    # 1. Create ADMIN user
    admin = UserEntity.create_new(
        email="admin.cali@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    # 2. Create ENTE_PUBLICO user
    ente = UserEntity.create_new(
        email="cruzroja.cali@sogr.gov.co",
        hashed_password=password_hasher.hash_password("entepass"),
        role=UserRole.ENTE_PUBLICO,
    )
    db_session.add(UserModel.from_entity(admin))
    db_session.add(UserModel.from_entity(ente))
    await db_session.flush()

    # 3. Generate JWT token for admin
    admin_token = token_service.create_token(
        subject=str(admin.id),
        role=admin.role.value,
        expires_delta=timedelta(minutes=60),
    )

    # 4. POST /api/v1/puntos-control
    payload = {
        "nombre": "Centro de Acopio Estadio Pascual Guerrero",
        "tipo": "acopio",
        "estado": "activo",
        "lat": 3.4296,
        "lng": -76.5414,
        "responsable_user_id": str(ente.id),
        "direccion": "Cra. 34 # 5B-10, Cali",
        "horario": "24 Horas",
        "telefono": "+57 (2) 555-1234",
        "responsable": "Cruz Roja Valle",
    }
    response = await client.post(
        "/api/v1/puntos-control",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["nombre"] == "Centro de Acopio Estadio Pascual Guerrero"
    assert data["lat"] == 3.4296
    assert data["lng"] == -76.5414
    assert data["responsable_user_id"] == str(ente.id)
    assert data["responsable"] == "Cruz Roja Valle"

    # 5. GET /api/v1/puntos-control (publicly readable)
    list_response = await client.get("/api/v1/puntos-control")
    assert list_response.status_code == 200
    list_data = list_response.json()
    assert len(list_data) == 1
    assert list_data[0]["nombre"] == "Centro de Acopio Estadio Pascual Guerrero"


@pytest.mark.asyncio
async def test_civil_cannot_create_punto_control(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    civil = UserEntity.create_new(
        email="ciudadano@ejemplo.com",
        hashed_password=password_hasher.hash_password("civilpass"),
        role=UserRole.CIVIL,
    )
    ente = UserEntity.create_new(
        email="bomberos@sogr.gov.co",
        hashed_password=password_hasher.hash_password("entepass"),
        role=UserRole.ENTE_PUBLICO,
    )
    db_session.add(UserModel.from_entity(civil))
    db_session.add(UserModel.from_entity(ente))
    await db_session.flush()

    civil_token = token_service.create_token(
        subject=str(civil.id),
        role=civil.role.value,
        expires_delta=timedelta(minutes=60),
    )

    payload = {
        "nombre": "Nodo No Permitido",
        "tipo": "acopio",
        "estado": "activo",
        "lat": 3.4500,
        "lng": -76.5300,
        "responsable_user_id": str(ente.id),
    }
    response = await client.post(
        "/api/v1/puntos-control",
        json=payload,
        headers={"Authorization": f"Bearer {civil_token}"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_cannot_assign_non_ente_publico_as_responsable(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = UserEntity.create_new(
        email="admin2@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    civil = UserEntity.create_new(
        email="civil_no_valido@sogr.gov.co",
        hashed_password=password_hasher.hash_password("pass"),
        role=UserRole.CIVIL,
    )
    db_session.add(UserModel.from_entity(admin))
    db_session.add(UserModel.from_entity(civil))
    await db_session.flush()

    admin_token = token_service.create_token(
        subject=str(admin.id),
        role=admin.role.value,
        expires_delta=timedelta(minutes=60),
    )

    payload = {
        "nombre": "Nodo Invalido",
        "tipo": "albergue",
        "estado": "activo",
        "lat": 3.4500,
        "lng": -76.5300,
        "responsable_user_id": str(civil.id),
    }
    response = await client.post(
        "/api/v1/puntos-control",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 400
    res_json = response.json()
    err_msg = res_json.get("error", {}).get("message", "") or res_json.get("detail", "")
    assert "ENTE_PUBLICO" in err_msg



@pytest.mark.asyncio
async def test_list_users_filtered_by_role(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    u1 = UserEntity.create_new("e1@sogr.gov.co", "h", UserRole.ENTE_PUBLICO)
    u2 = UserEntity.create_new("e2@sogr.gov.co", "h", UserRole.ENTE_PUBLICO)
    u3 = UserEntity.create_new("c1@sogr.gov.co", "h", UserRole.CIVIL)
    db_session.add(UserModel.from_entity(u1))
    db_session.add(UserModel.from_entity(u2))
    db_session.add(UserModel.from_entity(u3))
    await db_session.flush()

    res = await client.get("/api/v1/users?role=ENTE_PUBLICO")
    assert res.status_code == 200
    users = res.json()
    assert len(users) == 2
    for u in users:
        assert u["role"] == "ENTE_PUBLICO"
