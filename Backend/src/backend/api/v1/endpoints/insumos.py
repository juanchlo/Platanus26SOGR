"""Endpoints for querying catalog of relief items (insumos)."""

from collections.abc import Sequence
from fastapi import APIRouter, status

from backend.api.deps import InventarioServiceDep
from backend.schemas.inventario import InsumoResponse

router = APIRouter(prefix="/insumos", tags=["Catálogo de Insumos"])


@router.get(
    "",
    response_model=list[InsumoResponse],
    summary="List all Insumos",
    description="Retrieves the full catalog of relief supplies and categories (agua, alimentos, salud, etc.).",
    status_code=status.HTTP_200_OK,
)
async def list_insumos(
    inventario_service: InventarioServiceDep,
) -> Sequence[InsumoResponse]:
    """Retrieve catalog of insumos."""
    return await inventario_service.list_insumos()
