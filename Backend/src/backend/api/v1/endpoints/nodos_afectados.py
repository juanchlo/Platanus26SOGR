from datetime import datetime, timezone
import json
from typing import Sequence
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import DatabaseSession, RequireOperationalUser
from backend.domain.utils.geo import calculate_centroid, calculate_distance_meters
from backend.infrastructure.persistence.models.nodo_afectado import NodoAfectadoModel
from backend.schemas.nodo_afectado import (
    NodoAfectadoCreate,
    NodoAfectadoDetalleResponse,
    NodoAfectadoResponse,
    PlanAyudaResponse,
    TriageActivoItem,
)

FUSION_DISTANCE_METERS = 100.0

router = APIRouter(prefix="/nodos-afectados", tags=["Nodos Afectados & Planificación de Ayuda (IA)"])


async def _find_nearby_nodos_afectados(
    db: AsyncSession, lat: float, lng: float, radius_m: float
) -> Sequence[NodoAfectadoModel]:
    """Find active nodos_afectados within radius_m meters of (lat, lng).

    Mismo patrón que _find_nearby_necesidades en incidentes.py (hallazgo R-03 de
    docs/PLAN_MASTER_OPTIMIZACION.md): en PostgreSQL usa ST_DWithin sobre el índice
    GiST de nodos_afectados.geom para acotar los candidatos por índice antes de
    hidratar filas ORM completas; en SQLite (tests) cae al filtro Python original.
    """
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        nearby_ids_stmt = text(
            """
            SELECT id FROM nodos_afectados
            WHERE estado = 'activo'
              AND ST_DWithin(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                    :radio_m
                  )
            """
        )
        ids_res = await db.execute(nearby_ids_stmt, {"lat": lat, "lng": lng, "radio_m": radius_m})
        nearby_ids = [row[0] for row in ids_res.all()]
        if not nearby_ids:
            return []
        stmt = select(NodoAfectadoModel).where(NodoAfectadoModel.id.in_(nearby_ids))
        return (await db.execute(stmt)).scalars().all()

    active_stmt = select(NodoAfectadoModel).where(NodoAfectadoModel.estado == "activo")
    active_nodos = (await db.execute(active_stmt)).scalars().all()
    return [
        n
        for n in active_nodos
        if calculate_distance_meters(lat, lng, n.lat, n.lng) <= radius_m
    ]


@router.post(
    "",
    response_model=NodoAfectadoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report Affected Node",
    description="Allows OPERADOR_CAMPO, ADMIN_GUBERNAMENTAL or ENTE_PUBLICO to report a new emergency. Merges automatically if within 100m of an existing active affected node.",
)
async def create_nodo_afectado(
    payload: NodoAfectadoCreate,
    current_user: RequireOperationalUser,
    db: DatabaseSession,
) -> NodoAfectadoResponse:
    """Create or fuse a nodo_afectado within 100 meters; barrio/geom quedan a cargo del trigger de la DB."""
    # 1. Search for existing active affected nodes within 100m (vía PostGIS, ver
    # _find_nearby_nodos_afectados / hallazgo R-03).
    nearby_nodos = await _find_nearby_nodos_afectados(
        db, payload.lat, payload.lng, FUSION_DISTANCE_METERS
    )

    now_utc = datetime.now(timezone.utc)

    if not nearby_nodos:
        nodo = NodoAfectadoModel(
            titulo=payload.titulo,
            descripcion=payload.descripcion,
            necesidad=payload.necesidad,
            lat=payload.lat,
            lng=payload.lng,
            severidad=payload.severidad,
            personas_afectadas=payload.personas_afectadas,
            creado_por=current_user.id,
            creado_en=now_utc,
            actualizado_en=now_utc,
        )
        db.add(nodo)
        await db.commit()
        await db.refresh(nodo)
        return NodoAfectadoResponse.model_validate(nodo)

    # 3. FUSION: Merge all nearby affected nodes and new payload into single consolidated node
    primary_nodo = min(
        nearby_nodos,
        key=lambda n: calculate_distance_meters(payload.lat, payload.lng, n.lat, n.lng),
    )
    secondary_nodos = [n for n in nearby_nodos if n.id != primary_nodo.id]

    # Calculate cluster centroid
    all_coords = [(n.lat, n.lng) for n in nearby_nodos] + [(payload.lat, payload.lng)]
    c_lat, c_lng = calculate_centroid(all_coords)

    # Consolidate values
    total_personas = (
        (primary_nodo.personas_afectadas or 0)
        + sum((s.personas_afectadas or 0) for s in secondary_nodos)
        + (payload.personas_afectadas or 0)
    )
    max_severidad = max(
        [primary_nodo.severidad or 1]
        + [s.severidad or 1 for s in secondary_nodos]
        + [payload.severidad or 1]
    )

    # Merge descriptions & needs
    descripciones = [primary_nodo.descripcion] + [
        s.descripcion for s in secondary_nodos if s.descripcion
    ]
    if payload.descripcion and payload.descripcion not in descripciones:
        descripciones.append(payload.descripcion)

    necesidades = [primary_nodo.necesidad] + [
        s.necesidad for s in secondary_nodos if s.necesidad
    ]
    if payload.necesidad and payload.necesidad not in necesidades:
        necesidades.append(payload.necesidad)

    primary_nodo.lat = c_lat
    primary_nodo.lng = c_lng
    primary_nodo.personas_afectadas = total_personas
    primary_nodo.severidad = max_severidad
    primary_nodo.descripcion = " | ".join(dict.fromkeys(descripciones))
    primary_nodo.necesidad = ", ".join(dict.fromkeys(necesidades))
    primary_nodo.actualizado_en = now_utc

    # Remove secondary duplicate nodes
    for s in secondary_nodos:
        await db.delete(s)

    await db.commit()
    await db.refresh(primary_nodo)
    return NodoAfectadoResponse.model_validate(primary_nodo)


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
    "/{id}",
    response_model=NodoAfectadoDetalleResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Affected Node Detail (incluye el plan guardado al crearse)",
    description=(
        "Devuelve el nodo_afectado completo, incluyendo nodos_ayuda_asignados y "
        "plan_respuesta -- la foto fija que generó el trigger de Postgres al insertarse "
        "(Backend/supabase/plan_respuesta_nodo_afectado.sql), distinta del plan en vivo "
        "de /{id}/plan."
    ),
)
async def get_nodo_afectado(id: uuid.UUID, db: DatabaseSession) -> NodoAfectadoDetalleResponse:
    """Fetch one nodo_afectado by id, incluyendo el plan guardado por el trigger."""
    result = await db.execute(
        text(
            """
            SELECT id, titulo, descripcion, necesidad, lat, lng, severidad,
                   personas_afectadas, estado, barrio, creado_por, creado_en,
                   actualizado_en, nodos_ayuda_asignados, plan_respuesta
            FROM nodos_afectados
            WHERE id = :id
            """
        ),
        {"id": str(id)},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise NotFoundException(f"nodo_afectado con ID {id} no encontrado.")

    data = dict(row)
    if isinstance(data.get("nodos_ayuda_asignados"), str):
        data["nodos_ayuda_asignados"] = json.loads(data["nodos_ayuda_asignados"])
    return NodoAfectadoDetalleResponse.model_validate(data)


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
