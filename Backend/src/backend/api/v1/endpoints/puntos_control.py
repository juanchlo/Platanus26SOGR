"""Endpoints for managing Puntos de Control / Nodos logísticos, Inventario, and Peticiones."""

from collections.abc import Sequence
import uuid
from fastapi import APIRouter, status

from backend.api.deps import CurrentUser, InventarioServiceDep, PuntoControlServiceDep, RequireAdmin, RequirePublicEntity
from backend.domain.entities.user import UserRole
from backend.schemas.inventario import (
    InventarioBulkUpdateRequest,
    InventarioItemResponse,
    PeticionRecursoCreate,
    PeticionRecursoResponse,
)
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


@router.get(
    "/mis-nodos",
    response_model=list[PuntoControlResponse],
    summary="List Nodos Asignados al Usuario (Portal Ente Público)",
    description="Returns strictly the control points assigned to the authenticated ENTE_PUBLICO (or all nodes if ADMIN_GUBERNAMENTAL).",
    status_code=status.HTTP_200_OK,
)
async def list_mis_nodos(
    current_user: RequirePublicEntity,
    punto_service: PuntoControlServiceDep,
) -> Sequence[PuntoControlResponse]:
    """Retrieve assigned nodes for ENTE_PUBLICO portal."""
    if current_user.role == UserRole.ADMIN_GUBERNAMENTAL:
        puntos = await punto_service.list_all()
    else:
        puntos = await punto_service.list_by_responsable(current_user.id)
    return [PuntoControlResponse.model_validate(p) for p in puntos]


@router.post(
    "",
    response_model=PuntoControlResponse,
    summary="Create a new Punto de Control (Nodo)",
    description="Allows ADMIN_GUBERNAMENTAL and ENTE_PUBLICO to create/lift a new node with required coordinates.",
    status_code=status.HTTP_201_CREATED,
)
async def create_punto_control(
    payload: PuntoControlCreate,
    current_user: RequirePublicEntity,
    punto_service: PuntoControlServiceDep,
) -> PuntoControlResponse:
    """Create a new node for ADMIN_GUBERNAMENTAL or ENTE_PUBLICO."""
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


@router.get(
    "/{punto_id}/inventario",
    response_model=list[InventarioItemResponse],
    summary="Get Inventario of Node",
    description="Retrieves current inventory stock levels and catalog insumos for a specific node.",
    status_code=status.HTTP_200_OK,
)
async def get_inventario_nodo(
    punto_id: uuid.UUID,
    inventario_service: InventarioServiceDep,
) -> Sequence[InventarioItemResponse]:
    """Retrieve inventory for node."""
    return await inventario_service.get_inventario_by_punto(punto_id)


@router.put(
    "/{punto_id}/inventario",
    response_model=list[InventarioItemResponse],
    summary="Update Inventario of Node",
    description="Updates stock levels for insumos at a node. Only assigned ENTE_PUBLICO or ADMIN_GUBERNAMENTAL allowed.",
    status_code=status.HTTP_200_OK,
)
async def update_inventario_nodo(
    punto_id: uuid.UUID,
    payload: InventarioBulkUpdateRequest,
    current_user: RequirePublicEntity,
    inventario_service: InventarioServiceDep,
) -> Sequence[InventarioItemResponse]:
    """Update inventory levels for node."""
    return await inventario_service.update_inventario(
        punto_id=punto_id,
        payload=payload,
        current_user_id=current_user.id,
        current_user_role=current_user.role.value if hasattr(current_user.role, "value") else current_user.role,
    )


@router.post(
    "/{punto_id}/peticiones",
    response_model=PeticionRecursoResponse,
    summary="Create Emergency Resource Request for Node",
    description="Allows the assigned ENTE_PUBLICO to create an urgent resource request (necesidad) for their node.",
    status_code=status.HTTP_201_CREATED,
)
async def create_peticion_recurso(
    punto_id: uuid.UUID,
    payload: PeticionRecursoCreate,
    current_user: RequirePublicEntity,
    inventario_service: InventarioServiceDep,
) -> PeticionRecursoResponse:
    """Create emergency resource request for node."""
    return await inventario_service.create_peticion_recurso(
        punto_id=punto_id,
        payload=payload,
        current_user_id=current_user.id,
        current_user_role=current_user.role.value if hasattr(current_user.role, "value") else current_user.role,
    )
