"""Endpoints for querying catalog of relief items (insumos)."""

from collections.abc import Sequence
from fastapi import APIRouter, status
from sqlalchemy import select, text

from backend.api.deps import DatabaseSession, RequirePublicEntity, InventarioServiceDep
from backend.core.exceptions import ConflictException
from backend.domain.services.semantic_dedup_service import SemanticDedupService
from backend.infrastructure.persistence.models.inventario import InsumoModel
from backend.schemas.inventario import InsumoResponse
from backend.schemas.insumo_create import InsumoCreate, InsumoCreateResponse

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


@router.post(
    "",
    response_model=InsumoCreateResponse,
    summary="Create a new Insumo",
    description="Creates a new relief supply item with semantic deduplication.",
    status_code=status.HTTP_201_CREATED,
)
async def create_insumo(
    payload: InsumoCreate,
    _: RequirePublicEntity,
    db: DatabaseSession,
) -> InsumoCreateResponse:
    """Create a new insumo with semantic deduplication."""
    # Query all existing insumo names
    stmt = select(InsumoModel.nombre)
    result = await db.execute(stmt)
    existing_names = list(result.scalars().all())

    # Check for semantic duplicates
    dedup_result = await SemanticDedupService().check_duplicate(
        nombre_propuesto=payload.nombre,
        nombres_existentes=existing_names,
        db=db
    )

    if dedup_result.es_duplicado:
        raise ConflictException(
            f"El recurso es similar a uno ya existente: {dedup_result.recurso_equivalente}"
        )

    # Insert new InsumoModel
    new_insumo = InsumoModel(
        nombre=payload.nombre.strip(),
        categoria=payload.categoria,
        unidad=payload.unidad,
        criticidad=payload.criticidad,
    )
    try:
        db.add(new_insumo)
        await db.commit()
        await db.refresh(new_insumo)
    except Exception as e:
        await db.rollback()
        raise ConflictException(f"No se pudo registrar el recurso '{payload.nombre}': ya existe o infringe una restricción de la base de datos.") from e

    # Build response immediately with refreshed attributes
    response = InsumoCreateResponse(
        id=new_insumo.id,
        nombre=new_insumo.nombre,
        categoria=new_insumo.categoria,
        unidad=new_insumo.unidad,
        criticidad=new_insumo.criticidad,
        es_nuevo=True,
    )

    # Optionally refresh the materialized view if configured (non-fatal if not yet created in DB)
    try:
        await db.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY catalogo_insumos_ia"))
        await db.commit()
    except Exception:
        pass

    return response
