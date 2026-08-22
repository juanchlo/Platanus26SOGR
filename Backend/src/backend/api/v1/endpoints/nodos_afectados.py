"""Endpoints for Nodos Afectados: reportes de emergencia, triage y planificación de ayuda."""

import json
from typing import Sequence
import uuid

from fastapi import APIRouter, status
from sqlalchemy import text

from backend.api.deps import DatabaseSession, RequireFieldOperator
from backend.infrastructure.persistence.models.nodo_afectado import NodoAfectadoModel
from backend.schemas.nodo_afectado import (
    NodoAfectadoCreate,
    NodoAfectadoResponse,
    PlanAyudaResponse,
    TriageActivoItem,
)

router = APIRouter(prefix="/nodos-afectados", tags=["Nodos Afectados & Planificación de Ayuda (IA)"])


@router.post(
    "",
    response_model=NodoAfectadoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report Affected Node",
    description="Allows OPERADOR_CAMPO or ADMIN_GUBERNAMENTAL to report a new emergency. barrio se geocodifica automáticamente desde lat/lng (trigger de Postgres), no se setea acá.",
)
async def create_nodo_afectado(
    payload: NodoAfectadoCreate,
    current_user: RequireFieldOperator,
    db: DatabaseSession,
) -> NodoAfectadoResponse:
    """Create a new nodo_afectado; barrio/geom quedan a cargo del trigger de la DB."""
    nodo = NodoAfectadoModel(
        titulo=payload.titulo,
        descripcion=payload.descripcion,
        necesidad=payload.necesidad,
        lat=payload.lat,
        lng=payload.lng,
        severidad=payload.severidad,
        personas_afectadas=payload.personas_afectadas,
        creado_por=current_user.id,
    )
    db.add(nodo)
    await db.commit()
    await db.refresh(nodo)
    return NodoAfectadoResponse.model_validate(nodo)


@router.get(
    "",
    response_model=list[TriageActivoItem],
    status_code=status.HTTP_200_OK,
    summary="List Active Emergencies by Triage Priority",
    description="Returns all active nodos_afectados ordered by priority score, vía tool_triage_activo().",
)
async def list_nodos_afectados(db: DatabaseSession) -> Sequence[TriageActivoItem]:
    """List active emergencies ordered by triage score."""
    result = await db.execute(text("SELECT tool_triage_activo()"))
    raw_json = result.scalar_one_or_none() or "[]"
    data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    return [TriageActivoItem.model_validate(item) for item in data]


@router.get(
    "/{id}/plan",
    response_model=PlanAyudaResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Response Plan for an Affected Node",
    description="Corre la cascada greedy de asignación (asignar_ayuda, radio fijo 10km) para un nodo_afectado.",
)
async def get_plan_nodo_afectado(id: uuid.UUID, db: DatabaseSession) -> PlanAyudaResponse:
    """Get the greedy assignment plan for a nodo_afectado. Nunca lanza 404: asignar_ayuda() ya
    devuelve {"error": "..."} si el id no existe, en vez de fallar."""
    result = await db.execute(
        text("SELECT asignar_ayuda(:id, :radio)"),
        {"id": str(id), "radio": 10.0},
    )
    raw_json = result.scalar_one()
    data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    return PlanAyudaResponse.model_validate(data)
