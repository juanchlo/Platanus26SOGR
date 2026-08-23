"""Endpoints for querying catalog of relief items (insumos)."""

from collections.abc import Sequence
import logging

from fastapi import APIRouter, status
from sqlalchemy import select

from backend.api.deps import DatabaseSession, RequirePublicEntity, InventarioServiceDep
from backend.core.config import settings
from backend.core.exceptions import ConflictException
from backend.domain.services.semantic_dedup_service import SemanticDedupService
from backend.infrastructure import cache
from backend.infrastructure.persistence.models.inventario import InsumoModel
from backend.schemas.inventario import InsumoResponse
from backend.schemas.insumo_create import InsumoCreate, InsumoCreateResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/insumos", tags=["Catálogo de Insumos"])

CACHE_KEY_INSUMOS_LIST = "cache:insumos:catalogo"
# Prefijo compartido con recursos.py (consultar_recurso / resolver_insumo). Vive acá
# porque este es el módulo que crea insumos nuevos y por lo tanto el que invalida.
CACHE_PREFIX_RESOLVER_INSUMO = "cache:resolver-insumo:"


@router.get(
    "",
    response_model=list[InsumoResponse],
    summary="List all Insumos",
    description=(
        "Retrieves the full catalog of relief supplies and categories (agua, alimentos, "
        "salud, etc.). Cacheado en Redis con TTL largo (CACHE_TTL_INSUMOS_CATALOGO, catálogo "
        "de baja mutación) -- se invalida explícitamente al registrar un insumo nuevo."
    ),
    status_code=status.HTTP_200_OK,
)
async def list_insumos(
    inventario_service: InventarioServiceDep,
) -> Sequence[InsumoResponse]:
    """Retrieve catalog of insumos, cache-aside sobre Redis."""

    async def compute() -> list[dict]:
        insumos = await inventario_service.list_insumos()
        return [i.model_dump(mode="json") for i in insumos]

    data = await cache.get_or_set_json(
        CACHE_KEY_INSUMOS_LIST, settings.CACHE_TTL_INSUMOS_CATALOGO, compute
    )
    return [InsumoResponse.model_validate(item) for item in data]


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

    # Libera la conexión al pool antes del chequeo de deduplicación semántica: puede
    # reintentar hasta 3 modelos de Anthropic en secuencia (ver
    # domain/services/semantic_dedup_service.py), cada uno con varios segundos de
    # latencia de red externa. Sin este commit, la conexión quedaría retenida en `db`
    # durante toda esa espera (hallazgo R-02 de docs/PLAN_MASTER_OPTIMIZACION.md). No
    # hay nada pendiente de escribir en este punto -- es un no-op transaccional que solo
    # devuelve la conexión al pool; `db` se pasa igual al servicio para su fallback local
    # (resolver_insumo), que re-adquiere una conexión nueva solo si la usa.
    await db.commit()

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
        logger.warning("No se pudo registrar el insumo '%s': %s", payload.nombre, e)
        raise ConflictException(f"No se pudo registrar el recurso '{payload.nombre}': ya existe o infringe una restricción de la base de datos.") from e

    # catalogo_insumos_ia es una VIEW normal (no materializada) sobre insumos -- ver
    # Backend/supabase/catalogo_insumos_ia.sql -- por lo que siempre queda consistente
    # con este INSERT sin necesidad de ningun refresco explicito.

    # Invalida el catálogo cacheado y todo lo que resolver_insumo() pudiera haber
    # cacheado como "no encontrado" para nombres libres que este insumo nuevo ahora sí
    # resuelve (no hay forma de saber cuáles sin recorrer el prefijo completo).
    await cache.delete(CACHE_KEY_INSUMOS_LIST)
    await cache.delete_prefix(CACHE_PREFIX_RESOLVER_INSUMO)

    return InsumoCreateResponse(
        id=new_insumo.id,
        nombre=new_insumo.nombre,
        categoria=new_insumo.categoria,
        unidad=new_insumo.unidad,
        criticidad=new_insumo.criticidad,
        es_nuevo=True,
    )
