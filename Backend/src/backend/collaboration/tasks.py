"""Celery tasks para el módulo de colaboración.

Dos tasks principales:

  on_stock_update(punto_id, insumo_id, nueva_cantidad)
    ↳ Disparada por Supabase Realtime cuando inventario cambia.
    ↳ Actualiza Redis y re-corre greedy solo en needs:pending:{insumo_id}.
    ↳ ANTI-FANOUT: no toca nodos ni necesidades de otros insumos.

  on_new_need(need_id, insumo_id, qty_required, lat, lng, urgencia, suppliers)
    ↳ Disparada al crear una solicitud_insumo nueva.
    ↳ Registra la necesidad en Redis e intenta cobertura inmediata.

  _persist_assignments(need_id, insumo_id, assignments)
    ↳ Escribe asignaciones a Postgres (tabla asignaciones_insumo).
    ↳ Separada para no bloquear el worker de cobertura.
"""

import logging
from typing import Any

import redis as redis_lib
from celery import Celery
from sqlalchemy import text

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App Celery — broker apunta a Redis (misma instancia, DB 0 para jobs, DB 1 para estado)
# ---------------------------------------------------------------------------
from backend.core.config import settings  # noqa: E402  (import after log setup)

_REDIS_URL = getattr(settings, "REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "sogr_collaboration",
    broker=_REDIS_URL,
    backend=_REDIS_URL.replace("/0", "/1"),  # DB separada para results
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Bogota",
    task_track_started=True,
    # Reintentos automáticos con backoff exponencial
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)

# ---------------------------------------------------------------------------
# Cliente Redis compartido (sync, para las tasks Celery)
# ---------------------------------------------------------------------------
_redis_client: redis_lib.Redis | None = None


def get_redis() -> redis_lib.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.from_url(
            _REDIS_URL.replace("/0", "/2"),  # DB 2 exclusiva para estado de colaboración
            decode_responses=False,
        )
    return _redis_client


# ---------------------------------------------------------------------------
# Task 1: cambio de stock → re-evaluar pending needs de ese insumo
# ---------------------------------------------------------------------------

@celery_app.task(
    name="collaboration.on_stock_update",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
)
def on_stock_update(self, punto_id: str, insumo_id: str, nueva_cantidad: int) -> dict:
    """Actualiza stock en Redis y cubre necesidades pendientes del mismo insumo.

    Complejidad: O(P × log N) donde P = necesidades pendientes de este insumo
    y N = proveedores candidatos. No toca el resto de la red.
    """
    from backend.collaboration.greedy_cover import cover_need
    from backend.collaboration.redis_keys import pending_needs_key, stock_key

    r = get_redis()

    # 1. Sincronizar stock
    r.hset(stock_key(punto_id), insumo_id, max(0, nueva_cantidad))
    log.info("Stock actualizado: punto=%s insumo=%s qty=%d", punto_id, insumo_id, nueva_cantidad)

    if nueva_cantidad <= 0:
        return {"covered": []}

    # 2. Solo necesidades pendientes de ESTE insumo (anti-fanout)
    pending = r.zrevrange(pending_needs_key(insumo_id), 0, -1)  # mayor urgencia primero

    all_assignments: list[dict] = []

    for need_id_bytes in pending:
        need_id = need_id_bytes.decode()
        need_data = r.hgetall(f"need:{need_id}")
        if not need_data:
            continue

        assignments = cover_need(
            r,
            need_id=need_id,
            insumo_id=insumo_id,
            qty_required=int(need_data[b"qty_required"]),
            lat=float(need_data[b"lat"]),
            lng=float(need_data[b"lng"]),
        )

        if assignments:
            all_assignments.extend(assignments)
            # Persistir a Postgres en task separada (no bloquea el worker)
            _persist_assignments.delay(need_id, insumo_id, assignments)

    return {"covered": all_assignments}


# ---------------------------------------------------------------------------
# Task 2: nueva necesidad → registrar y cubrir inmediatamente
# ---------------------------------------------------------------------------

@celery_app.task(
    name="collaboration.on_new_need",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
)
def on_new_need(
    self,
    need_id: str,
    insumo_id: str,
    qty_required: int,
    lat: float,
    lng: float,
    urgencia: int,
    suppliers: list[dict],  # [{"punto_id": str, "distancia_m": float}]
) -> dict:
    """Registra una necesidad nueva y lanza cobertura inmediata."""
    from backend.collaboration.greedy_cover import (
        build_suppliers_cache,
        cover_need,
        register_pending_need,
    )

    r = get_redis()

    # 1. Cache de proveedores ordenados por distancia (calculado con PostGIS en el endpoint)
    build_suppliers_cache(r, insumo_id, lat, lng, suppliers)

    # 2. Registrar necesidad y meterla al pending ZSET
    register_pending_need(r, need_id, insumo_id, qty_required, lat, lng, urgencia)

    # 3. Cobertura inmediata
    assignments = cover_need(r, need_id, insumo_id, qty_required, lat, lng)

    if assignments:
        _persist_assignments.delay(need_id, insumo_id, assignments)

    return {"assignments": assignments}


# ---------------------------------------------------------------------------
# Task 3 (interna): persistir asignaciones a Postgres
# ---------------------------------------------------------------------------

@celery_app.task(
    name="collaboration.persist_assignments",
    bind=True,
    max_retries=5,
    default_retry_delay=10,
)
def _persist_assignments(
    self,
    need_id: str,
    insumo_id: str,
    assignments: list[dict],
) -> None:
    """Escribe las asignaciones confirmadas en la tabla asignaciones_insumo de Postgres.

    Usa upsert para ser idempotente ante reintentos.
    """
    import asyncio
    from backend.infrastructure.database import engine
    from sqlalchemy.ext.asyncio import AsyncSession

    async def _write():
        async with AsyncSession(engine) as session:
            for a in assignments:
                await session.execute(
                    text("""
                        INSERT INTO asignaciones_insumo
                            (id, solicitud_id, punto_apoyo_id, insumo_id, cantidad_asignada, estado)
                        VALUES
                            (:rid, :need_id, :punto_id, :insumo_id, :qty, 'pendiente')
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {
                        "rid": a["reservation_id"],
                        "need_id": need_id,
                        "punto_id": a["punto_id"],
                        "insumo_id": insumo_id,
                        "qty": a["qty"],
                    },
                )
            await session.commit()

    try:
        asyncio.run(_write())
        log.info("Asignaciones persistidas: need=%s count=%d", need_id, len(assignments))
    except Exception as exc:
        log.error("Error persistiendo asignaciones: %s", exc)
        raise self.retry(exc=exc)
