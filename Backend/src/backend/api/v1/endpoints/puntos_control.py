"""Endpoints for managing Puntos de Control / Nodos logísticos."""

from collections.abc import Sequence
import uuid
from fastapi import APIRouter, status

from backend.api.deps import PuntoControlServiceDep, RequireAdmin
from backend.schemas.punto_control import PuntoControlCreate, PuntoControlResponse

router = APIRouter(prefix="/puntos-control", tags=["Nodos & Infraestructura (Puntos de Control)"])


@router.get(
    "",
    response_model=list[PuntoControlResponse],
    summary="List all Puntos de Control (Nodos)",
    description="Retrieves the complete list of control points (acopio, albergues, hospitales, comando) for map display and logistics.",
    status_code=status.HTTP_200_OK,
)
async def list_puntos_control(
    punto_service: PuntoControlServiceDep,
) -> Sequence[PuntoControlResponse]:
    """Retrieve all control points."""
    puntos = await punto_service.list_all()
    return [PuntoControlResponse.model_validate(p) for p in puntos]


@router.post(
    "",
    response_model=PuntoControlResponse,
    summary="Create a new Punto de Control (Nodo)",
    description="Allows ADMIN_GUBERNAMENTAL to create/lift a new node with required coordinates and an assigned ENTE_PUBLICO as responsible.",
    status_code=status.HTTP_201_CREATED,
)
async def create_punto_control(
    payload: PuntoControlCreate,
    current_admin: RequireAdmin,
    punto_service: PuntoControlServiceDep,
) -> PuntoControlResponse:
    """Create a new node restricted strictly to ADMIN_GUBERNAMENTAL."""
    created = await punto_service.create_punto_control(
        nombre=payload.nombre,
        lat=payload.lat,
        lng=payload.lng,
        responsable_user_id=payload.responsable_user_id,
        tipo=payload.tipo,
        estado=payload.estado,
        direccion=payload.direccion,
        horario=payload.horario,
        telefono=payload.telefono,
        responsable=payload.responsable,
        verificado=payload.verificado,
    )
    return PuntoControlResponse.model_validate(created)


@router.get(
    "/{punto_id}",
    response_model=PuntoControlResponse,
    summary="Get Punto de Control by ID",
    description="Retrieves detail information for a specific control point.",
    status_code=status.HTTP_200_OK,
)
async def get_punto_control(
    punto_id: uuid.UUID,
    punto_service: PuntoControlServiceDep,
) -> PuntoControlResponse:
    """Retrieve node details by UUID."""
    punto = await punto_service.get_by_id(punto_id)
    return PuntoControlResponse.model_validate(punto)
