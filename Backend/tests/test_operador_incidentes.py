"""Tests for OPERADOR_CAMPO incident creation, AI testimony analysis, and RBAC rules."""

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
async def test_operador_campo_can_report_incident_with_ai_analysis(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test OPERADOR_CAMPO creating an affected node with AI testimony analysis."""
    # 1. Create OPERADOR_CAMPO user
    operador = UserEntity.create_new(
        email="operador.campo@sogr.gov.co",
        hashed_password=password_hasher.hash_password("op123"),
        role=UserRole.OPERADOR_CAMPO,
    )
    # Seed an insumo
    insumo = InsumoModel(
        id=uuid.uuid4(),
        nombre="Agua Potable",
        categoria="agua",
        unidad="litros",
        criticidad=5,
    )
    db_session.add(UserModel.from_entity(operador))
    db_session.add(insumo)
    await db_session.flush()

    operador_token = token_service.create_token(
        subject=str(operador.id),
        role=operador.role.value,
        expires_delta=timedelta(minutes=60),
    )

    # 2. Transmit testimony from GPS location in Siloé, Cali
    payload = {
        "testimonio": "Derrumbe severo en ladera de Siloé sector La Estrella. 12 familias atrapadas y sin agua potable, se requiere atención médica urgente por varios heridos.",
        "lat": 3.4250,
        "lng": -76.5580,
        "barrio": "Siloé",
    }

    response = await client.post(
        "/api/v1/incidentes",
        json=payload,
        headers={"Authorization": f"Bearer {operador_token}"},
    )
    assert response.status_code == 201
    data = response.json()

    # 3. Verify AI analysis and structured outputs
    assert "Derrumbe" in data["tipo"]
    assert data["urgencia"] >= 4  # High priority due to trapped families/injured
    assert "Diagnóstico IA" in data["analisis_ia"]
    assert len(data["recursos_solicitados"]) > 0
    assert any("Agua" in r["insumo_nombre"] for r in data["recursos_solicitados"])
    assert data["barrio"] == "Siloé"
    assert data["estado"] == "pendiente"
    assert data["operador_id"] == str(operador.id)

    # 4. List incidents
    list_res = await client.get("/api/v1/incidentes")
    assert list_res.status_code == 200
    incidentes = list_res.json()
    assert len(incidentes) >= 1
    assert any(i["id"] == data["id"] for i in incidentes)

    # 5. Update incident status to 'en_atencion'
    incidente_id = data["id"]
    status_res = await client.patch(
        f"/api/v1/incidentes/{incidente_id}/estado",
        json={"estado": "en_atencion"},
        headers={"Authorization": f"Bearer {operador_token}"},
    )
    assert status_res.status_code == 200
    assert status_res.json()["estado"] == "en_atencion"


@pytest.mark.asyncio
async def test_admin_and_ente_can_report_incident_without_geoloc(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test ADMIN_GUBERNAMENTAL and ENTE_PUBLICO can also create incident reports."""
    admin = UserEntity.create_new(
        email="admin.inc@sogr.gov.co",
        hashed_password=password_hasher.hash_password("adminpass"),
        role=UserRole.ADMIN_GUBERNAMENTAL,
    )
    ente = UserEntity.create_new(
        email="ente.inc@sogr.gov.co",
        hashed_password=password_hasher.hash_password("entepass"),
        role=UserRole.ENTE_PUBLICO,
    )
    civil = UserEntity.create_new(
        email="civil.inc@sogr.gov.co",
        hashed_password=password_hasher.hash_password("civilpass"),
        role=UserRole.CIVIL,
    )
    db_session.add(UserModel.from_entity(admin))
    db_session.add(UserModel.from_entity(ente))
    db_session.add(UserModel.from_entity(civil))
    await db_session.flush()

    admin_token = token_service.create_token(subject=str(admin.id), role=admin.role.value)
    ente_token = token_service.create_token(subject=str(ente.id), role=ente.role.value)
    civil_token = token_service.create_token(subject=str(civil.id), role=civil.role.value)

    payload = {
        "testimonio": "Inundación en Comuna 7 Alfonso López por desbordamiento del canal. Casas anegadas.",
        "lat": 3.4580,
        "lng": -76.4970,
        "barrio": "Alfonso López",
    }

    # Admin reports
    res_admin = await client.post(
        "/api/v1/incidentes",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res_admin.status_code == 201
    assert "Inundación" in res_admin.json()["tipo"]

    # Ente reports
    res_ente = await client.post(
        "/api/v1/incidentes",
        json=payload,
        headers={"Authorization": f"Bearer {ente_token}"},
    )
    assert res_ente.status_code == 201

    # Civil is forbidden
    res_civil = await client.post(
        "/api/v1/incidentes",
        json=payload,
        headers={"Authorization": f"Bearer {civil_token}"},
    )
    assert res_civil.status_code == 403
