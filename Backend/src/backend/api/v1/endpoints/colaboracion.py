"""Endpoints para el módulo de colaboración multi-nodo.

POST /colaboracion/solicitudes              → crear solicitud de insumo + lanzar cobertura
POST /colaboracion/stock-update             → webhook interno para Supabase Realtime
GET  /colaboracion/plan/{solicitud_id}      → ver plan de asignaciones de una solicitud
GET  /colaboracion/asignaciones-activas     → todas las asignaciones activas (para el mapa animado)
POST /colaboracion/redis-sync               → re-sincronizar Redis desde Postgres (admin)
"""

import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import DatabaseSession

log = logging.getLogger(__name__)
router = APIRouter(prefix="/colaboracion", tags=["Colaboración"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SolicitudInsumoCreate(BaseModel):
    nodo_afectado_id: UUID
    insumo_id: UUID
    cantidad_solicitada: int = Field(gt=0)
    urgencia: int = Field(default=3, ge=1, le=5)


class StockUpdateWebhook(BaseModel):
    """Payload del webhook disparado por Supabase Realtime → FastAPI → Celery."""
    punto_id: str
    insumo_id: str
    nueva_cantidad: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_redis():
    """Redis client para el módulo de colaboración (DB 2)."""
    import redis
    from backend.core.config import settings
    redis_url = getattr(settings, "REDIS_URL", "redis://localhost:6379/0")
    return redis.from_url(redis_url.replace("/0", "/2"), decode_responses=False)


async def _get_nearby_suppliers(
    db: AsyncSession,
    insumo_id: UUID,
    lat: float,
    lng: float,
    radio_m: int = 15_000,
) -> list[dict]:
    """Consulta PostGIS para obtener puntos de apoyo con stock, ordenados por distancia."""
    rows = await db.execute(
        text("""
            SELECT
                pc.id::text                         AS punto_id,
                ST_Distance(
                    ST_SetSRID(ST_MakePoint(pc.lng, pc.lat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat),     4326)::geography
                )                                   AS distancia_m
            FROM puntos_control pc
            JOIN inventario i ON i.punto_id = pc.id AND i.insumo_id = :insumo_id
            WHERE pc.estado = 'activo'
              AND COALESCE(i.cantidad_actual, 0) > 0
              AND ST_DWithin(
                    ST_SetSRID(ST_MakePoint(pc.lng, pc.lat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(:lng, :lat),     4326)::geography,
                    :radio_m
                )
            ORDER BY distancia_m ASC
        """),
        {"insumo_id": str(insumo_id), "lat": lat, "lng": lng, "radio_m": radio_m},
    )
    return [{"punto_id": r.punto_id, "distancia_m": r.distancia_m} for r in rows.fetchall()]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/solicitudes", status_code=status.HTTP_202_ACCEPTED)
async def crear_solicitud(
    body: SolicitudInsumoCreate,
    db: DatabaseSession,
) -> dict:
    """Crea una solicitud de insumo y lanza cobertura greedy asíncrona.

    1. Inserta en solicitudes_insumo.
    2. Obtiene nodo afectado (lat/lng).
    3. Consulta proveedores cercanos con PostGIS.
    4. Encola task Celery on_new_need (no bloquea la respuesta HTTP).
    """
    from backend.collaboration.tasks import on_new_need

    # Verificar que el nodo afectado existe
    na_row = await db.execute(
        text("SELECT lat, lng FROM nodos_afectados WHERE id = :id"),
        {"id": str(body.nodo_afectado_id)},
    )
    na = na_row.fetchone()
    if not na:
        raise HTTPException(status_code=404, detail="Nodo afectado no encontrado")

    # Insertar solicitud
    result = await db.execute(
        text("""
            INSERT INTO solicitudes_insumo
                (nodo_afectado_id, insumo_id, cantidad_solicitada, urgencia)
            VALUES (:na_id, :ins_id, :qty, :urgencia)
            RETURNING id::text
        """),
        {
            "na_id": str(body.nodo_afectado_id),
            "ins_id": str(body.insumo_id),
            "qty": body.cantidad_solicitada,
            "urgencia": body.urgencia,
        },
    )
    need_id: str = result.scalar_one()
    await db.commit()

    # Proveedores cercanos (PostGIS)
    suppliers = await _get_nearby_suppliers(db, body.insumo_id, na.lat, na.lng)

    if not suppliers:
        log.warning("No hay proveedores cercanos para insumo=%s en radio 15km", body.insumo_id)

    # Encolar cobertura asíncrona
    on_new_need.delay(
        need_id=need_id,
        insumo_id=str(body.insumo_id),
        qty_required=body.cantidad_solicitada,
        lat=na.lat,
        lng=na.lng,
        urgencia=body.urgencia,
        suppliers=suppliers,
    )

    return {
        "solicitud_id": need_id,
        "proveedores_candidatos": len(suppliers),
        "mensaje": "Cobertura greedy iniciada",
    }


@router.post("/stock-update")
async def stock_update_webhook(body: StockUpdateWebhook) -> dict:
    """Webhook interno: Supabase → FastAPI → Celery.

    Supabase Realtime no puede llamar Celery directamente.
    El cliente Next.js o un listener Python recibe el postgres_changes
    y llama este endpoint para que el worker re-evalúe necesidades.

    Alternativa: conectar un listener Python a Supabase Realtime que
    llame on_stock_update.delay() directamente (sin pasar por HTTP).
    """
    from backend.collaboration.tasks import on_stock_update

    on_stock_update.delay(
        punto_id=body.punto_id,
        insumo_id=body.insumo_id,
        nueva_cantidad=body.nueva_cantidad,
    )
    return {"queued": True}


@router.get("/plan/{solicitud_id}")
async def get_plan_cobertura(solicitud_id: UUID, db: DatabaseSession) -> list[dict]:
    """Retorna el plan de asignaciones actual de una solicitud de insumo."""
    rows = await db.execute(
        text("""
            SELECT
                solicitud_id,
                nodo_afectado,
                insumo,
                cantidad_solicitada,
                cantidad_cubierta,
                estado,
                urgencia,
                punto_apoyo,
                apoyo_lat,
                apoyo_lng,
                cantidad_asignada,
                estado_asignacion,
                ROUND(distancia_metros::numeric, 0)::int AS distancia_metros
            FROM vista_plan_cobertura
            WHERE solicitud_id = :sid
            ORDER BY distancia_metros ASC NULLS LAST
        """),
        {"sid": str(solicitud_id)},
    )
    return [dict(r._mapping) for r in rows.fetchall()]


@router.get("/asignaciones-activas")
async def get_asignaciones_activas(db: DatabaseSession) -> list[dict]:
    """Todas las asignaciones pendientes/en-tránsito para la capa animada del mapa.

    Retorna una fila por arco apoyo→afectado, con coordenadas de ambos extremos
    y la distancia en metros para que el frontend calcule la duración de la animación.
    Solo incluye asignaciones con coordenadas completas (el JOIN puede dejar NULLs
    si el punto de apoyo fue desactivado).
    """
    rows = await db.execute(
        text("""
            SELECT
                solicitud_id::text,
                nodo_afectado,
                ROUND(afectado_lat::numeric, 6)::float    AS afectado_lat,
                ROUND(afectado_lng::numeric, 6)::float    AS afectado_lng,
                insumo,
                cantidad_asignada,
                urgencia,
                punto_apoyo,
                ROUND(apoyo_lat::numeric, 6)::float       AS apoyo_lat,
                ROUND(apoyo_lng::numeric, 6)::float       AS apoyo_lng,
                estado_asignacion,
                COALESCE(ROUND(distancia_metros::numeric, 0)::int, 0) AS distancia_metros
            FROM vista_plan_cobertura
            WHERE estado_asignacion IN ('pendiente', 'en_transito')
              AND apoyo_lat IS NOT NULL
              AND apoyo_lng IS NOT NULL
              AND afectado_lat IS NOT NULL
              AND afectado_lng IS NOT NULL
            ORDER BY urgencia DESC, distancia_metros ASC
        """)
    )
    return [dict(r._mapping) for r in rows.fetchall()]


@router.post("/redis-sync", status_code=status.HTTP_200_OK)
async def redis_sync(db: DatabaseSession) -> dict:
    """Re-sincroniza Redis desde Postgres. Usar si Redis se reinició o perdió datos."""
    from backend.collaboration.sync import sync_inventario_to_redis, sync_pending_needs_to_redis

    r = _get_redis()
    inv = await sync_inventario_to_redis(db, r)
    needs = await sync_pending_needs_to_redis(db, r)
    return {"inventario_filas": inv, "solicitudes_pendientes": needs}
