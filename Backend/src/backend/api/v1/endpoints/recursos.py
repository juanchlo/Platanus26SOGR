"""Endpoints for resolución de sinónimos de insumos y registro cuantitativo de recursos."""

import json

from fastapi import APIRouter, Query, status
from sqlalchemy import text

from backend.api.deps import DatabaseSession, RequireFieldOperator
from backend.schemas.recurso import (
    ConsultaInsumoResponse,
    InventarioActualizadoItem,
    RegistrarRecursoCreate,
    RegistrarRecursoResponse,
)

router = APIRouter(prefix="/recursos", tags=["Recursos & Normalización de Insumos (IA)"])


@router.get(
    "/consultar",
    response_model=ConsultaInsumoResponse,
    status_code=status.HTTP_200_OK,
    summary="Resolve a Free-Text Resource Name to its Canonical Insumo",
    description=(
        "Lookup de solo lectura: resuelve un nombre libre (coincidencia exacta, sinónimo o parcial) "
        "a su insumo canónico, sin crear nada. No existe una función SQL que devuelva exactamente "
        "este shape sin escribir (esa lógica vive dentro de registrar_con_normalizacion(), que sí "
        "muta), así que se compone acá con 3 lecturas: resolver_insumo() + nombre del insumo + "
        "chequeo de existencia en sinonimos_insumos."
    ),
)
async def consultar_recurso(
    db: DatabaseSession,
    nombre: str = Query(..., min_length=1, description="Nombre libre a resolver (ej. 'agua potable')."),
) -> ConsultaInsumoResponse:
    """Resolve a free-text insumo name to its canonical form, read-only."""
    insumo_id_res = await db.execute(text("SELECT resolver_insumo(:nombre)"), {"nombre": nombre})
    insumo_id = insumo_id_res.scalar_one_or_none()

    if insumo_id is None:
        return ConsultaInsumoResponse(insumo_canonico=None, insumo_id=None, era_sinonimo=False)

    nombre_res = await db.execute(text("SELECT nombre FROM insumos WHERE id = :id"), {"id": insumo_id})
    insumo_canonico = nombre_res.scalar_one()

    sinonimo_res = await db.execute(
        text("SELECT EXISTS (SELECT 1 FROM sinonimos_insumos WHERE lower(sinonimo) = lower(trim(:nombre)))"),
        {"nombre": nombre},
    )
    era_sinonimo = bool(sinonimo_res.scalar_one())

    return ConsultaInsumoResponse(
        insumo_canonico=insumo_canonico,
        insumo_id=insumo_id,
        era_sinonimo=era_sinonimo,
    )


@router.post(
    "/registrar",
    response_model=RegistrarRecursoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register Resource Quantity with Synonym Normalization",
    description=(
        "Resuelve nombre_recurso vía registrar_con_normalizacion() (crea el insumo si no existe) "
        "y hace upsert de cantidad_actual/cantidad_necesaria en inventario para el punto dado."
    ),
)
async def registrar_recurso(
    payload: RegistrarRecursoCreate,
    current_user: RequireFieldOperator,
    db: DatabaseSession,
) -> RegistrarRecursoResponse:
    """Register a quantitative resource amount, normalizing the free-text insumo name."""
    result = await db.execute(
        text("SELECT registrar_con_normalizacion(:nombre, :punto_id, :nivel, :actual, :necesaria)"),
        {
            "nombre": payload.nombre_recurso,
            "punto_id": str(payload.punto_id),
            # El trigger calcular_nivel_inventario() recalcula "nivel" solo a partir de las
            # cantidades apenas se escribe -- este valor siempre queda pisado, es inerte.
            "nivel": "bien",
            "actual": payload.cantidad_actual,
            "necesaria": payload.cantidad_necesaria,
        },
    )
    raw_json = result.scalar_one()
    data = json.loads(raw_json) if isinstance(raw_json, str) else raw_json

    inv_res = await db.execute(
        text(
            """
            SELECT i.id AS insumo_id, i.nombre, inv.nivel, inv.cantidad_actual, inv.cantidad_necesaria
            FROM inventario inv
            JOIN insumos i ON i.id = inv.insumo_id
            WHERE inv.punto_id = :punto_id AND lower(i.nombre) = lower(:insumo_canonico)
            """
        ),
        {"punto_id": str(payload.punto_id), "insumo_canonico": data["insumo_canonico"]},
    )
    inv_row = inv_res.mappings().one()
    await db.commit()

    return RegistrarRecursoResponse(
        insumo_canonico=data["insumo_canonico"],
        era_sinonimo=data["era_sinonimo"],
        sinonimo_original=data["sinonimo_original"],
        inventario_actualizado=InventarioActualizadoItem.model_validate(dict(inv_row)),
    )
