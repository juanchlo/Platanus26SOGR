"""Tests for ENTE_PUBLICO lifecycle, node filtering, inventory updates, and inactivity alerts."""

from datetime import timedelta
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.entities.user import UserEntity, UserRole
from backend.infrastructure.persistence.models.inventario import InsumoModel
from backend.infrastructure.persistence.models.user import UserModel
from backend.infrastructure.security import password_hasher, token_service


@pytest.mark.asyncio
async def test_admin_can_create_and_toggle_ente_publico(client: AsyncClient, db_session: AsyncSession):
    """Test ADMIN_GUBERNAMENTAL can register a new ENTE_PUBLICO and toggle their status."""
    admin = UserEntity.create_new(
        email="admin.logic@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    civil = UserEntity.create_new(
        email="civil.logic@sogr.gov.co",
        hashed_password=password_hasher.hash_password("civilpass"),
        role=UserRole.CIVIL,
    )
    db_session.add(UserModel.from_entity(admin))
    db_session.add(UserModel.from_entity(civil))
    await db_session.flush()

    admin_token = token_service.create_token(subject=str(admin.id), role=admin.role.value)
    civil_token = token_service.create_token(subject=str(civil.id), role=civil.role.value)
    
    new_email = f"cruzroja_{uuid.uuid4().hex[:6]}@sogr.gov.co"
    payload = {
        "email": new_email,
        "password": "password123",
        "role": "ENTE_PUBLICO",
    }
    
    # 1. Create Ente Público
    res = await client.post(
        "/api/v1/users",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 201
    created_user = res.json()
    assert created_user["email"] == new_email
    assert created_user["role"] == "ENTE_PUBLICO"
    assert created_user["is_active"] is True
    
    user_id = created_user["id"]
    
    # 2. Disable user account
    toggle_res = await client.patch(
        f"/api/v1/users/{user_id}/status",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert toggle_res.status_code == 200
    assert toggle_res.json()["is_active"] is False
    
    # 3. Non-admin cannot create users
    unauth_res = await client.post(
        "/api/v1/users",
        json=payload,
        headers={"Authorization": f"Bearer {civil_token}"},
    )
    assert unauth_res.status_code == 403


@pytest.mark.asyncio
async def test_ente_publico_portal_filters_assigned_nodes(client: AsyncClient, db_session: AsyncSession):
    """Test that an ENTE_PUBLICO sees only their assigned nodes in /mis-nodos."""
    admin = UserEntity.create_new(
        email="admin.filter@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    db_session.add(UserModel.from_entity(admin))
    await db_session.flush()
    admin_token = token_service.create_token(subject=str(admin.id), role=admin.role.value)
    
    # Create two different ENTE_PUBLICO users
    ente1_res = await client.post(
        "/api/v1/users",
        json={"email": f"ente1_{uuid.uuid4().hex[:6]}@sogr.gov.co", "password": "password123", "role": "ENTE_PUBLICO"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert ente1_res.status_code == 201
    ente1_id = ente1_res.json()["id"]
    ente1_token = token_service.create_token(subject=ente1_id, role=UserRole.ENTE_PUBLICO.value)
    
    ente2_res = await client.post(
        "/api/v1/users",
        json={"email": f"ente2_{uuid.uuid4().hex[:6]}@sogr.gov.co", "password": "password123", "role": "ENTE_PUBLICO"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert ente2_res.status_code == 201
    ente2_id = ente2_res.json()["id"]
    ente2_token = token_service.create_token(subject=ente2_id, role=UserRole.ENTE_PUBLICO.value)
    
    # Create a node assigned to ente1
    nodo_name = f"Nodo Asignado a Ente 1 - {uuid.uuid4().hex[:6]}"
    create_nodo_res = await client.post(
        "/api/v1/puntos-control",
        json={
            "nombre": nodo_name,
            "tipo": "acopio",
            "estado": "activo",
            "lat": 3.4516,
            "lng": -76.5320,
            "responsable_user_id": ente1_id,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert create_nodo_res.status_code == 201
    
    # Ente 1 calls /mis-nodos -> should see the assigned node
    res_ente1 = await client.get(
        "/api/v1/puntos-control/mis-nodos",
        headers={"Authorization": f"Bearer {ente1_token}"},
    )
    assert res_ente1.status_code == 200
    nodos_ente1 = res_ente1.json()
    assert any(n["nombre"] == nodo_name for n in nodos_ente1)
    
    # Ente 2 calls /mis-nodos -> should NOT see ente 1's node
    res_ente2 = await client.get(
        "/api/v1/puntos-control/mis-nodos",
        headers={"Authorization": f"Bearer {ente2_token}"},
    )
    assert res_ente2.status_code == 200
    nodos_ente2 = res_ente2.json()
    assert not any(n["nombre"] == nodo_name for n in nodos_ente2)


@pytest.mark.asyncio
async def test_ente_publico_inventory_update_and_permission_check(client: AsyncClient, db_session: AsyncSession):
    """Test inventory retrieval and updates for assigned vs unassigned nodes."""
    admin = UserEntity.create_new(
        email="admin.inv@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    db_session.add(UserModel.from_entity(admin))
    
    # Seed at least one insumo in sqlite test db
    insumo = InsumoModel(
        id=uuid.uuid4(),
        nombre="Agua Potable 5L",
        categoria="agua",
        unidad="litros",
        criticidad=5,
    )
    db_session.add(insumo)
    await db_session.flush()
    
    admin_token = token_service.create_token(subject=str(admin.id), role=admin.role.value)
    
    # Create Ente and node
    ente_res = await client.post(
        "/api/v1/users",
        json={"email": f"ente_inv_{uuid.uuid4().hex[:6]}@sogr.gov.co", "password": "password123", "role": "ENTE_PUBLICO"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert ente_res.status_code == 201
    ente_id = ente_res.json()["id"]
    ente_token = token_service.create_token(subject=ente_id, role=UserRole.ENTE_PUBLICO.value)
    
    nodo_res = await client.post(
        "/api/v1/puntos-control",
        json={
            "nombre": f"Nodo Inventario {uuid.uuid4().hex[:6]}",
            "tipo": "albergue",
            "estado": "activo",
            "lat": 3.4296,
            "lng": -76.5414,
            "responsable_user_id": ente_id,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert nodo_res.status_code == 201
    punto_id = nodo_res.json()["id"]
    
    # Get catalog of insumos
    insumos_res = await client.get("/api/v1/insumos")
    assert insumos_res.status_code == 200
    insumos = insumos_res.json()
    assert len(insumos) > 0
    first_insumo_id = insumos[0]["id"]
    
    # 1. Fetch inventory of node
    inv_res = await client.get(f"/api/v1/puntos-control/{punto_id}/inventario")
    assert inv_res.status_code == 200
    assert len(inv_res.json()) > 0
    
    # 2. Assigned Ente updates quantitative inventory amounts
    update_payload = {
        "items": [
            {"insumo_id": first_insumo_id, "cantidad_actual": 20, "cantidad_necesaria": 100}
        ]
    }
    update_res = await client.put(
        f"/api/v1/puntos-control/{punto_id}/inventario",
        json=update_payload,
        headers={"Authorization": f"Bearer {ente_token}"},
    )
    assert update_res.status_code == 200
    updated_items = update_res.json()
    item_updated = next(i for i in updated_items if i["insumo_id"] == first_insumo_id)
    assert item_updated["cantidad_actual"] == 20
    assert item_updated["cantidad_necesaria"] == 100
    assert item_updated["deficit"] == 80
    assert item_updated["nivel"] == "poco"

    
    # 3. Unassigned Ente tries to update -> 403 Forbidden
    other_ente = UserEntity.create_new(
        email="other.ente@sogr.gov.co",
        hashed_password=password_hasher.hash_password("pass"),
        role=UserRole.ENTE_PUBLICO,
    )
    db_session.add(UserModel.from_entity(other_ente))
    await db_session.flush()
    other_token = token_service.create_token(subject=str(other_ente.id), role=UserRole.ENTE_PUBLICO.value)
    
    forbidden_res = await client.put(
        f"/api/v1/puntos-control/{punto_id}/inventario",
        json=update_payload,
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert forbidden_res.status_code == 403


@pytest.mark.asyncio
async def test_ente_publico_emergency_resource_request(client: AsyncClient, db_session: AsyncSession):
    """Test ENTE_PUBLICO creating an emergency resource request for their node."""
    admin = UserEntity.create_new(
        email="admin.req@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    db_session.add(UserModel.from_entity(admin))
    await db_session.flush()
    admin_token = token_service.create_token(subject=str(admin.id), role=admin.role.value)
    
    ente_res = await client.post(
        "/api/v1/users",
        json={"email": f"ente_req_{uuid.uuid4().hex[:6]}@sogr.gov.co", "password": "password123", "role": "ENTE_PUBLICO"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert ente_res.status_code == 201
    ente_id = ente_res.json()["id"]
    ente_token = token_service.create_token(subject=ente_id, role=UserRole.ENTE_PUBLICO.value)
    
    nodo_res = await client.post(
        "/api/v1/puntos-control",
        json={
            "nombre": f"Nodo Peticion {uuid.uuid4().hex[:6]}",
            "tipo": "hospital",
            "estado": "activo",
            "lat": 3.4292,
            "lng": -76.5463,
            "responsable_user_id": ente_id,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert nodo_res.status_code == 201
    punto_id = nodo_res.json()["id"]
    
    peticion_payload = {
        "tipo": "Agua Potable y Medicamentos",
        "descripcion": "Se requieren 500 litros de agua y suero oral urgente para atender afectados.",
        "urgencia": 5,
    }
    
    peticion_res = await client.post(
        f"/api/v1/puntos-control/{punto_id}/peticiones",
        json=peticion_payload,
        headers={"Authorization": f"Bearer {ente_token}"},
    )
    assert peticion_res.status_code == 201
    pet_data = peticion_res.json()
    assert pet_data["tipo"] == "Agua Potable y Medicamentos"
    assert "500 litros" in pet_data["descripcion"]
    assert pet_data["urgencia"] == 5
    assert pet_data["estado"] == "pendiente"


@pytest.mark.asyncio
async def test_alertas_nodos_inactivos(client: AsyncClient):
    """Test the /api/v1/alertas/nodos-inactivos endpoint."""
    res = await client.get("/api/v1/alertas/nodos-inactivos")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
