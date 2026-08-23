"""Celery tasks para el módulo de colaboración.

Tasks principales:

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

  finalizar_entrega_automatica(solicitud_id)
    ↳ Red de seguridad: programada con countdown al despachar (ver
      _garantizar_despacho_en_atencion en incidentes.py) para marcar la
      entrega como completada aunque nadie tenga el mapa abierto viendo
      la animación de transporte. Idempotente frente a POST /colaboracion/
      entregar/{id} si el frontend ya la completó antes.
"""

import logging
import math
from typing import Any

import redis as redis_lib
from celery import Celery

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

# Radio de búsqueda de proveedores (mismo valor que _get_nearby_suppliers en colaboracion.py)
_SUPPLIERS_RADIO_M = 15_000


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia en metros entre dos puntos (lat/lng en grados)."""
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _get_punto_coords(punto_id: str) -> tuple[float, float] | None:
    """Devuelve (lat, lng) del punto desde Postgres. None si no existe."""
    import psycopg2
    from backend.core.config import settings
    db_url = settings.DATABASE_URL.replace("+asyncpg", "")
    if db_url.startswith("sqlite"):
        return None
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("SELECT lat, lng FROM puntos_control WHERE id = %s", (punto_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        return (row[0], row[1]) if row else None
    except Exception as exc:
        log.error("_get_punto_coords: error obteniendo coords de %s: %s", punto_id, exc)
        return None

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
    from backend.collaboration.redis_keys import pending_needs_key, stock_key, suppliers_key

    r = get_redis()

    # 1. Sincronizar stock
    r.hset(stock_key(punto_id), insumo_id, max(0, nueva_cantidad))
    log.info("Stock actualizado: punto=%s insumo=%s qty=%d", punto_id, insumo_id, nueva_cantidad)

    if nueva_cantidad <= 0:
        return {"covered": []}

    # 2. Solo necesidades pendientes de ESTE insumo (anti-fanout)
    pending = r.zrevrange(pending_needs_key(insumo_id), 0, -1)  # mayor urgencia primero

    if not pending:
        return {"covered": []}

    # 3. Coordenadas del punto que acaba de recibir stock: lo añadimos al ZSET
    #    de proveedores de cada necesidad pendiente que esté dentro del radio.
    #    Bug original: si el nodo tenía 0 stock cuando se creó la necesidad,
    #    nunca entró en el ZSET; al recibir stock después, cover_need lo ignoraba
    #    y seguía usando nodos más lejanos que sí estaban en el ZSET.
    punto_coords = _get_punto_coords(punto_id)

    all_assignments: list[dict] = []

    for need_id_bytes in pending:
        need_id = need_id_bytes.decode()
        need_data = r.hgetall(f"need:{need_id}")
        if not need_data:
            continue

        lat = float(need_data[b"lat"])
        lng = float(need_data[b"lng"])

        # Agregar este punto al ZSET del need si está dentro del radio de búsqueda
        if punto_coords is not None:
            dist_m = _haversine_m(lat, lng, punto_coords[0], punto_coords[1])
            if dist_m <= _SUPPLIERS_RADIO_M:
                r.zadd(suppliers_key(insumo_id, lat, lng), {punto_id: dist_m})

        assignments = cover_need(
            r,
            need_id=need_id,
            insumo_id=insumo_id,
            qty_required=int(need_data[b"qty_required"]),
            lat=lat,
            lng=lng,
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

    Usa psycopg2 síncrono (no asyncio.run) para evitar conflictos de event loop
    con el engine async de FastAPI cuando se ejecuta en el proceso Celery.
    Upsert ON CONFLICT para ser idempotente ante reintentos.
    """
    import psycopg2
    from backend.core.config import settings

    # asyncpg URL → psycopg2 URL (el driver cambia, el resto es igual)
    db_url = settings.DATABASE_URL
    if "+asyncpg" in db_url:
        db_url = db_url.replace("+asyncpg", "")
    # SQLite no tiene soporte en producción pero protegemos el caso de test
    if db_url.startswith("sqlite"):
        log.warning("_persist_assignments: SQLite detectado, saltando persistencia (solo tests)")
        return

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        for a in assignments:
            cur.execute(
                """
                INSERT INTO asignaciones_insumo
                    (id, solicitud_id, punto_apoyo_id, insumo_id, cantidad_asignada, estado)
                VALUES (%s, %s, %s, %s, %s, 'pendiente')
                ON CONFLICT (id) DO NOTHING
                """,
                (a["reservation_id"], need_id, a["punto_id"], insumo_id, a["qty"]),
            )
        conn.commit()
        cur.close()
        conn.close()
        log.info("Asignaciones persistidas: need=%s count=%d", need_id, len(assignments))
    except Exception as exc:
        log.error("Error persistiendo asignaciones: %s", exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Task 4: red de seguridad — finalizar una entrega despachada aunque nadie
# esté viendo la animación de transporte en el mapa.
# ---------------------------------------------------------------------------

def transit_duration_seconds(distancia_m: float, cantidad: int) -> float:
    """Misma fórmula que getTransitDuration() en Frontend/components/map/MapCanvas.tsx
    (4s base + 0.4ms/m + 3ms/unidad, tope 20s) para que la task de backend no dispare
    antes de que la animación visual del arco haya terminado de recorrerse."""
    return min(4000 + distancia_m * 0.4 + cantidad * 3, 20_000) / 1000


@celery_app.task(
    name="collaboration.finalizar_entrega_automatica",
    bind=True,
    max_retries=3,
    default_retry_delay=5,
)
def finalizar_entrega_automatica(self, solicitud_id: str) -> dict:
    """Equivalente síncrono (psycopg2, mismo patrón que _persist_assignments) de
    completar_entrega() en colaboracion.py -- ver ese endpoint para el detalle de
    la lógica de déficit. Se programa con countdown = transit_duration_seconds()
    desde _garantizar_despacho_en_atencion, así que corre sola sin depender de que
    el frontend llame a POST /colaboracion/entregar/{id} al terminar su animación.

    Idempotente: si el frontend ya completó esta solicitud antes, las UPDATEs
    vuelven a dejar las mismas filas en 'entregado' sin efecto adicional.
    """
    import psycopg2
    from backend.core.config import settings

    db_url = settings.DATABASE_URL
    if "+asyncpg" in db_url:
        db_url = db_url.replace("+asyncpg", "")
    if db_url.startswith("sqlite"):
        log.warning("finalizar_entrega_automatica: SQLite detectado, saltando (solo tests)")
        return {"skipped": True}

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        cur.execute(
            "SELECT nodo_afectado_id, cantidad_solicitada FROM solicitudes_insumo WHERE id = %s",
            (solicitud_id,),
        )
        sol_row = cur.fetchone()
        if not sol_row:
            cur.close()
            conn.close()
            return {"found": False}

        na_id, cant_solicitada = sol_row

        # 1. Marcar como entregadas las asignaciones de esta solicitud
        cur.execute(
            "UPDATE asignaciones_insumo SET estado = 'entregado', actualizado_en = now() "
            "WHERE solicitud_id = %s AND estado != 'entregado'",
            (solicitud_id,),
        )

        # 2. Recalcular cobertura de la solicitud
        cur.execute(
            "SELECT COALESCE(SUM(cantidad_asignada), 0) FROM asignaciones_insumo "
            "WHERE solicitud_id = %s AND estado = 'entregado'",
            (solicitud_id,),
        )
        cant_cubierta = int(cur.fetchone()[0] or 0)
        cant_solicitada = int(cant_solicitada or 0)
        sol_estado = (
            "cubierta" if cant_cubierta >= cant_solicitada
            else ("parcial" if cant_cubierta > 0 else "pendiente")
        )
        cur.execute(
            "UPDATE solicitudes_insumo SET estado = %s, cantidad_cubierta = %s, actualizado_en = now() "
            "WHERE id = %s",
            (sol_estado, cant_cubierta, solicitud_id),
        )

        # 3. Evaluar déficit del nodo afectado completo (todas sus solicitudes)
        cur.execute(
            "SELECT cantidad_solicitada, cantidad_cubierta, estado FROM solicitudes_insumo "
            "WHERE nodo_afectado_id = %s",
            (na_id,),
        )
        all_sols = cur.fetchall()
        has_deficit = not all_sols or any(
            int(cub or 0) < int(req or 0) or est != "cubierta" for req, cub, est in all_sols
        )

        # Caso 1: sin déficit -> archivar (soft delete): pasa a 'resuelto' y desaparece
        # de las listas activas (GET /incidentes filtra estado != 'resuelto').
        if not has_deficit:
            cur.execute(
                "UPDATE nodos_afectados SET estado = 'resuelto', actualizado_en = now() WHERE id = %s",
                (na_id,),
            )
            cur.execute(
                "UPDATE necesidades SET estado = 'resuelto', actualizado_en = now() WHERE id = %s",
                (na_id,),
            )
        # Caso 2: déficit presente -> se mantiene 'en_atencion', NO se archiva ni resuelve
        # hasta que una futura entrega (animación o esta misma task en otra solicitud) lo cubra.

        conn.commit()
        cur.close()
        conn.close()
        log.info(
            "finalizar_entrega_automatica: solicitud=%s nodo=%s resuelto=%s",
            solicitud_id, na_id, not has_deficit,
        )
        return {"nodo_id": na_id, "resuelto": not has_deficit}
    except Exception as exc:
        log.error("finalizar_entrega_automatica: error para solicitud=%s: %s", solicitud_id, exc)
        raise self.retry(exc=exc)
