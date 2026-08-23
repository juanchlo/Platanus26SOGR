"""Endpoints for Field Operator Incident Reports and AI-driven Resource Needs Assessment."""

from datetime import datetime, timezone
import json
from typing import Sequence
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import DatabaseSession, RequireOperationalUser, RequirePublicEntity
from backend.core.exceptions import NotFoundException
from backend.domain.services.llm_analysis_service import LLMAnalysisService
from backend.domain.utils.geo import calculate_distance_meters
from backend.infrastructure.persistence.models.inventario import InsumoModel
from backend.infrastructure.persistence.models.necesidad import NecesidadModel
from backend.schemas.incidente import (
    IncidenteCreate,
    IncidenteResponse,
    IncidenteStatusUpdate,
    IncidenteUpdate,
    RecursoSugerido,
)

router = APIRouter(prefix="/incidentes", tags=["Incidentes & Operador de Campo (IA)"])

FUSION_DISTANCE_METERS = 100.0


def _parse_recursos(raw_recursos: str | None) -> list[RecursoSugerido]:
    if not raw_recursos:
        return []
    try:
        data = json.loads(raw_recursos)
        return [RecursoSugerido.model_validate(r) for r in data]
    except Exception:
        return []


async def _find_nearby_necesidades(
    db: AsyncSession, lat: float, lng: float, radius_m: float
) -> Sequence[NecesidadModel]:
    """Find active/pending necesidades within radius_m meters of (lat, lng).

    En PostgreSQL delega el filtro espacial a PostGIS (ST_DWithin sobre el índice GiST
    de necesidades.geom): una sola query trae solo los ids candidatos dentro del radio,
    sin traer testimonio/analisis_ia/recursos_solicitados de filas que ni siquiera están
    cerca, y sin calcular Haversine en Python sobre la tabla completa (ver hallazgo R-03
    de docs/PLAN_MASTER_OPTIMIZACION.md). Las filas ORM completas se hidratan solo para
    esos pocos ids, porque la lógica de fusión de más abajo necesita instancias
    gestionadas por la sesión para poder mutar el nodo primario y borrar los secundarios.

    En dialectos sin PostGIS (SQLite, usado por la suite de tests) cae al filtro Python
    original sobre el conjunto activo -- comportamiento idéntico al previo.
    """
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        nearby_ids_stmt = text(
            """
            SELECT id FROM necesidades
            WHERE estado IN ('pendiente', 'en_atencion')
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
        stmt = select(NecesidadModel).where(NecesidadModel.id.in_(nearby_ids))
        return (await db.execute(stmt)).scalars().all()

    active_stmt = select(NecesidadModel).where(NecesidadModel.estado.in_(["pendiente", "en_atencion"]))
    active_incs = (await db.execute(active_stmt)).scalars().all()
    return [
        inc
        for inc in active_incs
        if calculate_distance_meters(lat, lng, inc.lat, inc.lng) <= radius_m
    ]


@router.post(
    "",
    response_model=IncidenteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Report Affected Node / Incident with AI Testimony Analysis",
    description="Allows OPERADOR_CAMPO, ADMIN_GUBERNAMENTAL, and ENTE_PUBLICO to report an incident. An LLM analyzes the testimony to estimate supply requirements and suggest priority.",
)
async def create_incidente(
    payload: IncidenteCreate,
    current_user: RequireOperationalUser,
    db: DatabaseSession,
) -> IncidenteResponse:
    """Create a new incident with AI analysis of the operator testimony."""
    # 1. Fetch available insumos catalog for LLM context
    insumos_stmt = select(InsumoModel.nombre, InsumoModel.categoria, InsumoModel.unidad)
    insumos_res = await db.execute(insumos_stmt)
    insumos_rows = insumos_res.all()
    available_insumos = [str(row[0]) for row in insumos_rows]
    available_insumos_detail = [
        {"nombre": str(row[0]), "categoria": str(row[1] or ""), "unidad": str(row[2] or "")}
        for row in insumos_rows
    ]

    # Libera la conexión al pool antes de llamar al LLM (2-10s de latencia de red
    # externa a Anthropic): sin este commit, la conexión quedaría retenida en `db`
    # durante toda esa espera. Con pool_size=5 + max_overflow=10, bastan ~15 reportes
    # concurrentes para agotar el pool y bloquear toda la API mientras se espera al LLM
    # (hallazgo R-02 de docs/PLAN_MASTER_OPTIMIZACION.md). No hay nada pendiente de
    # escribir en este punto -- es un commit de solo-lectura -- así que es un no-op
    # transaccional cuyo único efecto es devolver la conexión al pool; la siguiente
    # query adquiere una nueva de forma transparente.
    await db.commit()

    # 2. Run LLM Analysis on the operator's testimony (sin conexión de DB retenida)
    llm_service = LLMAnalysisService()
    analysis = await llm_service.analyze_incident_testimony(
        testimonio=payload.testimonio,
        available_insumos=available_insumos,
        lat=payload.lat,
        lng=payload.lng,
        barrio_context=payload.barrio or payload.direccion,
        available_insumos_detail=available_insumos_detail,
    )

    urgencia_final = payload.urgencia_manual if payload.urgencia_manual is not None else analysis.urgencia
    barrio_final = payload.barrio or analysis.barrio_sugerido or payload.direccion or "Cali"
    now_utc = datetime.now(timezone.utc)

    # 3. Check for existing active/pending incidents within 100 meters (vía PostGIS,
    # ver _find_nearby_necesidades / hallazgo R-03) -- adquiere una conexión nueva del
    # pool, ya liberada la que se usó para leer el catálogo antes del LLM.
    from backend.domain.utils.geo import calculate_centroid

    nearby_incs = await _find_nearby_necesidades(
        db, payload.lat, payload.lng, FUSION_DISTANCE_METERS
    )

    # 4. Serialize structured resources requested by AI
    new_recursos = [r.model_dump() for r in analysis.recursos_requeridos]

    if not nearby_incs:
        recursos_json = json.dumps(new_recursos, ensure_ascii=False)
        incidente = NecesidadModel(
            tipo=analysis.tipo,
            descripcion=analysis.diagnostico,
            lat=payload.lat,
            lng=payload.lng,
            barrio=barrio_final,
            urgencia=urgencia_final,
            estado="pendiente",
            testimonio=payload.testimonio,
            analisis_ia=analysis.diagnostico,
            recursos_solicitados=recursos_json,
            prioridad_sugerida=analysis.urgencia,
            operador_id=current_user.id,
            origen_reporte=current_user.role.value,
            creado_en=now_utc,
            actualizado_en=now_utc,
        )
        db.add(incidente)
        await db.commit()
        await db.refresh(incidente)

        return IncidenteResponse(
            id=incidente.id,
            tipo=incidente.tipo,
            descripcion=incidente.descripcion,
            lat=incidente.lat,
            lng=incidente.lng,
            barrio=incidente.barrio,
            urgencia=incidente.urgencia or 3,
            estado=incidente.estado,
            testimonio=incidente.testimonio,
            analisis_ia=incidente.analisis_ia,
            recursos_solicitados=_parse_recursos(incidente.recursos_solicitados),
            prioridad_sugerida=incidente.prioridad_sugerida,
            operador_id=incidente.operador_id,
            origen_reporte=incidente.origen_reporte,
            creado_en=incidente.creado_en,
            actualizado_en=incidente.actualizado_en,
        )

    # FUSION: Merge into primary incident
    primary_inc = min(
        nearby_incs,
        key=lambda inc: calculate_distance_meters(payload.lat, payload.lng, inc.lat, inc.lng),
    )
    secondary_incs = [inc for inc in nearby_incs if inc.id != primary_inc.id]

    # Calculate cluster centroid
    all_coords = [(inc.lat, inc.lng) for inc in nearby_incs] + [(payload.lat, payload.lng)]
    c_lat, c_lng = calculate_centroid(all_coords)

    # Consolidate urgency and priority
    merged_urgencia = max(
        [primary_inc.urgencia or 1]
        + [s.urgencia or 1 for s in secondary_incs]
        + [urgencia_final or 1]
    )
    merged_prioridad = max(
        [primary_inc.prioridad_sugerida or 1]
        + [s.prioridad_sugerida or 1 for s in secondary_incs]
        + [analysis.urgencia or 1]
    )

    # Consolidate testimonies & diagnostics
    testimonios = [primary_inc.testimonio] + [s.testimonio for s in secondary_incs if s.testimonio]
    if payload.testimonio and payload.testimonio not in testimonios:
        testimonios.append(payload.testimonio)

    # Consolidate resources map
    recursos_map: dict[str, dict[str, Any]] = {}
    for inc in [primary_inc] + secondary_incs:
        for r in _parse_recursos(inc.recursos_solicitados):
            key = r.insumo_nombre.strip().lower()
            if key not in recursos_map:
                recursos_map[key] = {
                    "insumo_nombre": r.insumo_nombre,
                    "cantidad_estimada": r.cantidad_estimada,
                    "unidad": r.unidad,
                    "razon": r.razon,
                }
            else:
                recursos_map[key]["cantidad_estimada"] += r.cantidad_estimada

    for nr in new_recursos:
        key = nr.get("insumo_nombre", "").strip().lower()
        if key not in recursos_map:
            recursos_map[key] = nr
        else:
            recursos_map[key]["cantidad_estimada"] += nr.get("cantidad_estimada", 0)

    primary_inc.lat = c_lat
    primary_inc.lng = c_lng
    primary_inc.urgencia = merged_urgencia
    primary_inc.prioridad_sugerida = merged_prioridad
    primary_inc.testimonio = " | ".join(dict.fromkeys(filter(None, testimonios)))
    primary_inc.recursos_solicitados = json.dumps(list(recursos_map.values()), ensure_ascii=False)
    primary_inc.actualizado_en = now_utc

    for s in secondary_incs:
        await db.delete(s)

    await db.commit()
    await db.refresh(primary_inc)

    return IncidenteResponse(
        id=primary_inc.id,
        tipo=primary_inc.tipo,
        descripcion=primary_inc.descripcion,
        lat=primary_inc.lat,
        lng=primary_inc.lng,
        barrio=primary_inc.barrio,
        urgencia=primary_inc.urgencia or 3,
        estado=primary_inc.estado,
        testimonio=primary_inc.testimonio,
        analisis_ia=primary_inc.analisis_ia,
        recursos_solicitados=_parse_recursos(primary_inc.recursos_solicitados),
        prioridad_sugerida=primary_inc.prioridad_sugerida,
        operador_id=primary_inc.operador_id,
        origen_reporte=primary_inc.origen_reporte,
        creado_en=primary_inc.creado_en,
        actualizado_en=primary_inc.actualizado_en,
    )


@router.get(
    "",
    response_model=list[IncidenteResponse],
    status_code=status.HTTP_200_OK,
    summary="List Reported Incidents / Affected Nodes",
    description="Returns all active incidents and emergency reports ordered by urgency and date.",
)
async def list_incidentes(db: DatabaseSession) -> Sequence[IncidenteResponse]:
    """Retrieve all incident records with parsed AI analysis."""
    stmt = select(NecesidadModel).order_by(
        NecesidadModel.urgencia.desc(),
        NecesidadModel.creado_en.desc(),
    )
    result = await db.execute(stmt)
    records = result.scalars().all()

    return [
        IncidenteResponse(
            id=inc.id,
            tipo=inc.tipo,
            descripcion=inc.descripcion,
            lat=inc.lat,
            lng=inc.lng,
            barrio=inc.barrio,
            urgencia=inc.urgencia or 3,
            estado=inc.estado,
            testimonio=inc.testimonio,
            analisis_ia=inc.analisis_ia,
            recursos_solicitados=_parse_recursos(inc.recursos_solicitados),
            prioridad_sugerida=inc.prioridad_sugerida,
            operador_id=inc.operador_id,
            origen_reporte=inc.origen_reporte,
            creado_en=inc.creado_en,
            actualizado_en=inc.actualizado_en,
        )
        for inc in records
    ]


@router.patch(
    "/{id}/estado",
    response_model=IncidenteResponse,
    status_code=status.HTTP_200_OK,
    summary="Update Incident Status",
    description="Update the status of an incident ('pendiente', 'en_atencion', 'resuelto').",
)
async def update_incidente_status(
    id: uuid.UUID,
    payload: IncidenteStatusUpdate,
    current_user: RequireOperationalUser,
    db: DatabaseSession,
) -> IncidenteResponse:
    """Update operational state of an incident."""
    stmt = select(NecesidadModel).where(NecesidadModel.id == id)
    result = await db.execute(stmt)
    inc = result.scalar_one_or_none()
    if not inc:
        raise NotFoundException(f"Incidente con ID {id} no encontrado.")

    inc.estado = payload.estado
    inc.actualizado_en = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(inc)

    return IncidenteResponse(
        id=inc.id,
        tipo=inc.tipo,
        descripcion=inc.descripcion,
        lat=inc.lat,
        lng=inc.lng,
        barrio=inc.barrio,
        urgencia=inc.urgencia or 3,
        estado=inc.estado,
        testimonio=inc.testimonio,
        analisis_ia=inc.analisis_ia,
        recursos_solicitados=_parse_recursos(inc.recursos_solicitados),
        prioridad_sugerida=inc.prioridad_sugerida,
        operador_id=inc.operador_id,
        origen_reporte=inc.origen_reporte,
        creado_en=inc.creado_en,
        actualizado_en=inc.actualizado_en,
    )


@router.patch(
    "/{id}",
    response_model=IncidenteResponse,
    status_code=status.HTTP_200_OK,
    summary="Update Incident Fields",
    description="Edit testimony, urgency, type, or state of an incident.",
)
async def update_incidente(
    id: uuid.UUID,
    payload: IncidenteUpdate,
    current_user: RequirePublicEntity,
    db: DatabaseSession,
) -> IncidenteResponse:
    stmt = select(NecesidadModel).where(NecesidadModel.id == id)
    result = await db.execute(stmt)
    inc = result.scalar_one_or_none()
    if not inc:
        raise NotFoundException(f"Incidente con ID {id} no encontrado.")

    if payload.testimonio is not None:
        inc.testimonio = payload.testimonio
    if payload.urgencia is not None:
        inc.urgencia = payload.urgencia
        inc.prioridad_sugerida = payload.urgencia
    if payload.tipo is not None:
        inc.tipo = payload.tipo
    if payload.estado is not None:
        inc.estado = payload.estado
    inc.actualizado_en = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(inc)

    return IncidenteResponse(
        id=inc.id,
        tipo=inc.tipo,
        descripcion=inc.descripcion,
        lat=inc.lat,
        lng=inc.lng,
        barrio=inc.barrio,
        urgencia=inc.urgencia or 3,
        estado=inc.estado,
        testimonio=inc.testimonio,
        analisis_ia=inc.analisis_ia,
        recursos_solicitados=_parse_recursos(inc.recursos_solicitados),
        prioridad_sugerida=inc.prioridad_sugerida,
        operador_id=inc.operador_id,
        origen_reporte=inc.origen_reporte,
        creado_en=inc.creado_en,
        actualizado_en=inc.actualizado_en,
    )


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Incident",
    description="Permanently delete an incident report.",
)
async def delete_incidente(
    id: uuid.UUID,
    current_user: RequirePublicEntity,
    db: DatabaseSession,
) -> None:
    stmt = select(NecesidadModel).where(NecesidadModel.id == id)
    result = await db.execute(stmt)
    inc = result.scalar_one_or_none()
    if not inc:
        raise NotFoundException(f"Incidente con ID {id} no encontrado.")
    await db.delete(inc)
    await db.commit()


from fastapi import File, UploadFile, WebSocket, WebSocketDisconnect
from backend.domain.services.elevenlabs_stt_service import (
    ElevenLabsSTTService,
    TranscripcionAudioResponse,
)


@router.websocket("/ws/transcribir-audio")
@router.websocket("/ws-transcripcion")
async def websocket_transcripcion_operador(websocket: WebSocket) -> None:
    """WebSocket bridge for streaming audio chunks to ElevenLabs Scribe v2 Realtime."""
    await websocket.accept()
    stt_service = ElevenLabsSTTService()
    try:
        await stt_service.stream_transcribe_ws(websocket)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass


@router.post(
    "/transcribir-audio",
    response_model=TranscripcionAudioResponse,
    status_code=status.HTTP_200_OK,
    summary="Transcribe Field Voice Recording using ElevenLabs Scribe STT",
    description="Accepts an audio file (.webm, .wav, .mp3, .ogg) and transcribes it into text using ElevenLabs Speech-to-Text API.",
)
async def transcribir_audio_operador(
    current_user: RequireOperationalUser,
    file: UploadFile = File(...),
) -> TranscripcionAudioResponse:
    """Transcribe audio recording from the field operator into text using ElevenLabs."""
    audio_bytes = await file.read()
    stt_service = ElevenLabsSTTService()
    return await stt_service.transcribe_audio(
        audio_bytes=audio_bytes,
        filename=file.filename or "audio_operador.webm",
        content_type=file.content_type or "audio/webm",
    )

