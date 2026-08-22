"""Endpoint del snapshot global de estado de ciudad, contexto agregado para agentes IA."""

import json

from fastapi import APIRouter, status
from sqlalchemy import text

from backend.api.deps import DatabaseSession
from backend.schemas.ciudad import EstadoCiudadResponse

router = APIRouter(prefix="/ciudad", tags=["Ciudad & Contexto Global (IA)"])


@router.get(
    "/estado",
    response_model=EstadoCiudadResponse,
    status_code=status.HTTP_200_OK,
    summary="Global City State Snapshot",
    description=(
        "Snapshot agregado en un solo JSON del estado actual de Cali (estado_ciudad()): "
        "conteo de puntos_control por estado, misiones urgentes, nodos inactivos y déficit "
        "de insumos a nivel ciudad -- pensado para que un agente arme un reporte/alerta "
        "sin tener que hacer 4-5 llamadas separadas."
    ),
)
async def get_estado_ciudad(db: DatabaseSession) -> EstadoCiudadResponse:
    """Retrieve the full city-state snapshot."""
    result = await db.execute(text("SELECT estado_ciudad()"))
    raw_json = result.scalar_one()
    data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
    return EstadoCiudadResponse.model_validate(data)
