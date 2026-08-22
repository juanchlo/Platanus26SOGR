"""Endpoints for Field Operator Incident Reports and AI-driven Resource Needs Assessment."""

from datetime import datetime, timezone
import json
from typing import Sequence
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from backend.api.deps import DatabaseSession, RequireOperationalUser
from backend.core.exceptions import NotFoundException
from backend.domain.services.llm_analysis_service import LLMAnalysisService
from backend.infrastructure.persistence.models.inventario import InsumoModel
from backend.infrastructure.persistence.models.necesidad import NecesidadModel
from backend.schemas.incidente import (
    IncidenteCreate,
    IncidenteResponse,
    IncidenteStatusUpdate,
    RecursoSugerido,
)

router = APIRouter(prefix="/incidentes", tags=["Incidentes & Operador de Campo (IA)"])


def _parse_recursos(raw_recursos: str | None) -> list[RecursoSugerido]:
    if not raw_recursos:
        return []
    try:
        data = json.loads(raw_recursos)
        return [RecursoSugerido.model_validate(r) for r in data]
    except Exception:
        return []


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
    insumos_stmt = select(InsumoModel.nombre)
    insumos_res = await db.execute(insumos_stmt)
    available_insumos = [str(name) for name in insumos_res.scalars().all()]

    # 2. Run LLM Analysis on the operator's testimony
    llm_service = LLMAnalysisService()
    analysis = await llm_service.analyze_incident_testimony(
        testimonio=payload.testimonio,
        available_insumos=available_insumos,
        lat=payload.lat,
        lng=payload.lng,
        barrio_context=payload.barrio or payload.direccion,
    )

    urgencia_final = payload.urgencia_manual if payload.urgencia_manual is not None else analysis.urgencia
    barrio_final = payload.barrio or analysis.barrio_sugerido or payload.direccion or "Cali"
    now_utc = datetime.now(timezone.utc)

    # 3. Serialize structured resources requested by AI
    recursos_json = json.dumps([r.model_dump() for r in analysis.recursos_requeridos], ensure_ascii=False)

    # 4. Insert into database (necesidades table)
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

