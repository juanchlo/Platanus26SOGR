"""Tests for automatic fusion and clustering of nearby Nodos Afectados (100 meters)."""

from datetime import timedelta
import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.entities.user import UserEntity, UserRole
from backend.domain.utils.geo import calculate_centroid, calculate_distance_meters
from backend.infrastructure.persistence.models.necesidad import NecesidadModel
from backend.infrastructure.persistence.models.nodo_afectado import NodoAfectadoModel
from backend.infrastructure.persistence.models.user import UserModel
from backend.infrastructure.security import password_hasher, token_service


def test_geo_distance_and_centroid():
    # Siloé point: 3.4250, -76.5580
    # ~55m north (0.0005 lat)
    d = calculate_distance_meters(3.4250, -76.5580, 3.4255, -76.5580)
    assert 50 < d < 60

    c_lat, c_lng = calculate_centroid([(3.4250, -76.5580), (3.4256, -76.5580)])
    assert c_lat == 3.4253
    assert c_lng == -76.5580


@pytest.mark.asyncio
async def test_nodos_afectados_fusion_within_100_meters(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """When an affected node is created within 100m of an existing active one, they must merge."""
    operador = UserEntity.create_new(
        email="operador.afectado@sogr.gov.co",
        hashed_password=password_hasher.hash_password("operadorpass"),
        role=UserRole.OPERADOR_CAMPO,
    )
    db_session.add(UserModel.from_entity(operador))
    await db_session.flush()

    token = token_service.create_token(
        subject=str(operador.id),
        role=operador.role.value,
        expires_delta=timedelta(minutes=60),
    )

    # 1. First report at Siloé (3.4250, -76.5580)
    payload_1 = {
        "titulo": "Derrumbe Sector La Estrella",
        "descripcion": "Deslizamiento de tierra afecta 5 viviendas.",
        "necesidad": "Ambulancias, palas y rescate",
        "lat": 3.4250,
        "lng": -76.5580,
        "severidad": 3,
        "personas_afectadas": 15,
    }
    res_1 = await client.post(
        "/api/v1/nodos-afectados",
        json=payload_1,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_1.status_code == 201
    data_1 = res_1.json()
    nodo_1_id = data_1["id"]
    assert data_1["personas_afectadas"] == 15
    assert data_1["severidad"] == 3

    # 2. Second report ~55m away (3.4255, -76.5580)
    payload_2 = {
        "titulo": "Colapso de Muro La Estrella",
        "descripcion": "Muro de contención colapsó, 3 familias evacuadas.",
        "necesidad": "Agua potable, albergue",
        "lat": 3.4255,
        "lng": -76.5580,
        "severidad": 4,
        "personas_afectadas": 10,
    }
    res_2 = await client.post(
        "/api/v1/nodos-afectados",
        json=payload_2,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res_2.status_code == 201
    fused_data = res_2.json()

    # Should retain the ID of the primary node
    assert fused_data["id"] == nodo_1_id
    # Coordinates should be centroid
    assert abs(fused_data["lat"] - 3.42525) < 0.0001
    assert abs(fused_data["lng"] - (-76.5580)) < 0.0001
    # Personas afectadas summed: 15 + 10 = 25
    assert fused_data["personas_afectadas"] == 25
    # Severidad should be max(3, 4) = 4
    assert fused_data["severidad"] == 4
    assert "Deslizamiento" in fused_data["descripcion"]
    assert "Muro de contención" in fused_data["descripcion"]
    assert "Ambulancias" in fused_data["necesidad"]
    assert "Agua potable" in fused_data["necesidad"]

    # Verify only ONE record in database
    stmt = select(NodoAfectadoModel)
    all_nodos = (await db_session.execute(stmt)).scalars().all()
    assert len(all_nodos) == 1
    assert all_nodos[0].id == uuid.UUID(nodo_1_id)


@pytest.mark.asyncio
async def test_incidentes_endpoint_fusion_within_100_meters(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """When reporting via POST /api/v1/incidentes within 100m, they must merge."""
    operador = UserEntity.create_new(
        email="operador.inc@sogr.gov.co",
        hashed_password=password_hasher.hash_password("operadorpass"),
        role=UserRole.OPERADOR_CAMPO,
    )
    db_session.add(UserModel.from_entity(operador))
    await db_session.flush()

    token = token_service.create_token(
        subject=str(operador.id),
        role=operador.role.value,
        expires_delta=timedelta(minutes=60),
    )

    # 1. First report at Siloé (3.4250, -76.5580)
    p1 = {
        "testimonio": "Derrumbe en Siloé La Estrella, se requieren palas y agua",
        "lat": 3.4250,
        "lng": -76.5580,
        "barrio": "Siloé",
        "urgencia_manual": 3,
    }
    r1 = await client.post("/api/v1/incidentes", json=p1, headers={"Authorization": f"Bearer {token}"})
    assert r1.status_code == 201
    d1 = r1.json()
    p1_id = d1["id"]

    # 2. Second report ~55m away (3.4255, -76.5580)
    p2 = {
        "testimonio": "Colapso de vía en la misma zona de Siloé, 3 heridos",
        "lat": 3.4255,
        "lng": -76.5580,
        "barrio": "Siloé",
        "urgencia_manual": 5,
    }
    r2 = await client.post("/api/v1/incidentes", json=p2, headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 201
    d2 = r2.json()

    assert d2["id"] == p1_id
    assert d2["urgencia"] == 5
    assert "Derrumbe" in d2["testimonio"]
    assert "Colapso" in d2["testimonio"]

    # Verify only ONE record exists in NecesidadModel
    stmt = select(NecesidadModel)
    all_necesidades = (await db_session.execute(stmt)).scalars().all()
    assert len(all_necesidades) == 1
