"""Sincronización inicial Postgres → Redis.

Llamar al arrancar el servidor (startup event de FastAPI) para cargar
el inventario vigente en Redis. Sin esto, el algoritmo greedy no ve stock.

También expone un endpoint /admin/redis-sync para re-sincronizar en caliente
si Redis pierde datos (restart, flushdb, etc.).
"""

import logging

import redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.collaboration.redis_keys import stock_key

log = logging.getLogger(__name__)


async def sync_inventario_to_redis(db: AsyncSession, r: redis.Redis) -> int:
    """Carga todo el inventario vigente de Postgres en Redis.

    Retorna el número de filas sincronizadas.

    SQL: une puntos_control (solo tipo='apoyo' y estado='activo') con inventario.
    Cada punto queda como HASH stock:{punto_id} = {insumo_id: cantidad_actual}.
    """
    rows = await db.execute(
        text("""
            SELECT
                i.punto_id::text,
                i.insumo_id::text,
                COALESCE(i.cantidad_actual, 0) AS cantidad
            FROM inventario i
            JOIN puntos_control pc ON pc.id = i.punto_id
            WHERE pc.estado = 'activo'
              AND COALESCE(i.cantidad_actual, 0) > 0
        """)
    )
    records = rows.fetchall()

    if not records:
        log.warning("sync_inventario_to_redis: no hay inventario activo en Postgres")
        return 0

    pipe = r.pipeline(transaction=False)
    for punto_id, insumo_id, cantidad in records:
        pipe.hset(stock_key(punto_id), insumo_id, cantidad)
    pipe.execute()

    log.info("Redis sync: %d filas de inventario cargadas", len(records))
    return len(records)


async def sync_pending_needs_to_redis(db: AsyncSession, r: redis.Redis) -> int:
    """Carga solicitudes_insumo pendientes (no cubiertas) en el pending ZSET.

    Llamar tras sync_inventario_to_redis para que el algoritmo pueda
    re-intentar cubrir necesidades que quedaron pendientes antes del restart.
    """
    from backend.collaboration.greedy_cover import register_pending_need

    rows = await db.execute(
        text("""
            SELECT
                si.id::text,
                si.insumo_id::text,
                si.cantidad_solicitada,
                na.lat,
                na.lng,
                COALESCE(na.severidad, 3) AS urgencia
            FROM solicitudes_insumo si
            JOIN nodos_afectados na ON na.id = si.nodo_afectado_id
            WHERE si.estado = 'pendiente'
              AND si.cantidad_cubierta < si.cantidad_solicitada
        """)
    )
    records = rows.fetchall()

    for need_id, insumo_id, qty_required, lat, lng, urgencia in records:
        register_pending_need(r, need_id, insumo_id, qty_required, lat, lng, urgencia)

    log.info("Redis sync: %d solicitudes pendientes cargadas", len(records))
    return len(records)
