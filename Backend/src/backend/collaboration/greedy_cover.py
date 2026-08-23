"""Algoritmo greedy multi-nodo para cobertura de necesidades de insumos.

Cómo funciona:
  1. Para una necesidad (need_id, insumo_id, qty_required) y ubicación del nodo afectado:
  2. Obtiene nodos de apoyo ordenados por distancia (ZSET pre-calculado con PostGIS).
  3. Itera nearest→farthest y reserva stock de cada uno hasta cubrir la cantidad.
  4. La reserva usa un Lua script para ser atómica: sin race conditions entre workers.
  5. Retorna la lista de asignaciones (punto_id, qty_reserved).

Ejemplo: necesito 100 linternas.
  - Nodo A (200m): tiene 90 → reservo 90, faltan 10.
  - Nodo B (450m): tiene 40 → reservo 10, cubierto.
  - Resultado: [(A, 90), (B, 10)]
"""

import uuid
import logging
from typing import Any

import redis

from backend.collaboration.redis_keys import (
    SUPPLIERS_TTL_SECONDS,
    need_key,
    pending_needs_key,
    reservation_key,
    stock_key,
    suppliers_key,
)

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lua script: reserva atómica de stock
# Retorna la cantidad realmente reservada (puede ser menor si hay poco stock).
# Atómico en Redis: ni dos workers pueden reservar la misma unidad.
# ---------------------------------------------------------------------------
_LUA_RESERVE = """
local current = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or 0)
if current <= 0 then return 0 end
local to_take = math.min(current, tonumber(ARGV[2]))
if to_take <= 0 then return 0 end
redis.call('HINCRBY', KEYS[1], ARGV[1], -to_take)
return to_take
"""


def _get_reserve_script(r: redis.Redis) -> Any:
    """Registra el Lua script una sola vez en la conexión."""
    if not hasattr(r, "_sogr_reserve_script"):
        r._sogr_reserve_script = r.register_script(_LUA_RESERVE)  # type: ignore[attr-defined]
    return r._sogr_reserve_script  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Función principal
# ---------------------------------------------------------------------------

def cover_need(
    r: redis.Redis,
    need_id: str,
    insumo_id: str,
    qty_required: int,
    lat: float,
    lng: float,
) -> list[dict]:
    """Cubre una necesidad usando el algoritmo greedy nearest-first.

    Retorna lista de reservas realizadas:
      [{"reservation_id": ..., "punto_id": ..., "qty": ...}, ...]
    Las reservas descuentan el stock en Redis inmediatamente.
    La persistencia a Postgres es responsabilidad del caller (task Celery).
    """
    nk = need_key(need_id)
    need_data = r.hgetall(nk)

    if not need_data:
        log.warning("cover_need: need_id=%s no existe en Redis", need_id)
        return []

    already_covered = int(need_data.get(b"qty_covered", 0))
    qty_still_needed = qty_required - already_covered

    if qty_still_needed <= 0:
        # Ya cubierta: limpiarla del pending ZSET si aún está
        r.zrem(pending_needs_key(insumo_id), need_id)
        return []

    sk = suppliers_key(insumo_id, lat, lng)
    # Ordered nearest→farthest (menor score = menor distancia)
    supplier_ids: list[bytes] = r.zrange(sk, 0, -1)

    if not supplier_ids:
        log.warning(
            "cover_need: sin proveedores cacheados para insumo=%s cerca de (%.4f, %.4f). "
            "Llama a build_suppliers_cache() primero.",
            insumo_id, lat, lng,
        )
        return []

    reserve_script = _get_reserve_script(r)
    assignments: list[dict] = []

    for supplier_bytes in supplier_ids:
        if qty_still_needed <= 0:
            break

        punto_id = supplier_bytes.decode()
        reserved = reserve_script(
            keys=[stock_key(punto_id)],
            args=[insumo_id, qty_still_needed],
        )
        reserved = int(reserved)

        if reserved <= 0:
            continue

        qty_still_needed -= reserved
        rid = str(uuid.uuid4())
        pipe = r.pipeline(transaction=False)
        pipe.hset(reservation_key(rid), mapping={
            "need_id": need_id,
            "punto_id": punto_id,
            "insumo_id": insumo_id,
            "qty": reserved,
            "estado": "pendiente",
        })
        # Registrar que este punto atiende esta necesidad
        pipe.sadd(f"needs:by_punto:{punto_id}", need_id)
        pipe.execute()

        assignments.append({"reservation_id": rid, "punto_id": punto_id, "qty": reserved})
        log.debug("Reservado: punto=%s insumo=%s qty=%d", punto_id, insumo_id, reserved)

    total_reserved = sum(a["qty"] for a in assignments)
    if total_reserved > 0:
        r.hincrby(nk, "qty_covered", total_reserved)

    qty_covered_total = already_covered + total_reserved
    if qty_covered_total >= qty_required:
        # Necesidad completamente cubierta: sacar del pending
        r.zrem(pending_needs_key(insumo_id), need_id)
        log.info("Necesidad %s cubierta al 100%% (%d unidades de %s)", need_id, qty_required, insumo_id)
    else:
        log.info(
            "Necesidad %s parcialmente cubierta: %d/%d de insumo %s",
            need_id, qty_covered_total, qty_required, insumo_id,
        )

    return assignments


# ---------------------------------------------------------------------------
# Cache de proveedores (se construye con una query PostGIS)
# ---------------------------------------------------------------------------

def build_suppliers_cache(
    r: redis.Redis,
    insumo_id: str,
    lat: float,
    lng: float,
    suppliers: list[dict],  # [{"punto_id": str, "distancia_m": float}, ...]
) -> None:
    """Precarga el ZSET de proveedores ordenados por distancia para (insumo, ubicación).

    Llamar desde el endpoint que registra una necesidad nueva, pasando el resultado
    de la función PostGIS puntos_cercanos() o una query con ST_Distance.

    TTL de 10 minutos: suficiente para el ciclo de vida de la mayoría de operaciones.
    """
    sk = suppliers_key(insumo_id, lat, lng)
    pipe = r.pipeline(transaction=False)
    pipe.delete(sk)
    for s in suppliers:
        pipe.zadd(sk, {s["punto_id"]: s["distancia_m"]})
    pipe.expire(sk, SUPPLIERS_TTL_SECONDS)
    pipe.execute()


def register_pending_need(
    r: redis.Redis,
    need_id: str,
    insumo_id: str,
    qty_required: int,
    lat: float,
    lng: float,
    urgencia: int = 3,
) -> None:
    """Registra una necesidad en Redis y la encola en el pending ZSET.

    Llamar al crear una necesidad en Postgres. Después de esto, el worker
    on_stock_update intentará cubrirla automáticamente.
    """
    nk = need_key(need_id)
    r.hset(nk, mapping={
        "insumo_id": insumo_id,
        "qty_required": qty_required,
        "qty_covered": 0,
        "lat": lat,
        "lng": lng,
        "urgencia": urgencia,
    })
    # Score = urgencia (5=crítica, 1=baja). ZREVRANGE la saca primero.
    r.zadd(pending_needs_key(insumo_id), {need_id: urgencia})
