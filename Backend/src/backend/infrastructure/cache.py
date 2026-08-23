"""Async Redis cache client and JSON caching helpers.

Ver docs/PLAN_MASTER_OPTIMIZACION.md, sección 4.4 (estrategia de caching) --
este módulo implementa la capa de caché distribuida sobre Redis Stack
(docker-compose.yml en la raíz del repo) para los endpoints de alta
frecuencia de lectura y baja frecuencia de mutación identificados ahí.

Diseño: degradación suave. Si Redis no está disponible al arrancar, o se
cae en cualquier momento, todo helper de este módulo actúa como cache-miss
silencioso (get -> None, set/delete -> no-op) en vez de propagar el error --
la API tiene que seguir funcionando sin caché, solo más lenta. Ningún
endpoint debería fallar por un problema de Redis.
"""

from collections.abc import Awaitable, Callable
import json
import logging
from typing import Any

import redis.asyncio as redis

from backend.core.config import settings

logger = logging.getLogger(__name__)

# Cliente global, inicializado en el lifespan de main.py (connect_cache) y
# cerrado limpiamente en el shutdown (disconnect_cache). None mientras no
# esté conectado -- todos los helpers de abajo lo tratan como "sin caché".
_redis_client: redis.Redis | None = None


async def connect_cache() -> None:
    """Connect to Redis at startup. Never raises: si falla, loguea un warning
    y la app sigue funcionando con degradación suave (cache-miss permanente)."""
    global _redis_client

    if not settings.CACHE_ENABLED:
        logger.info("CACHE_ENABLED=false -- caché desactivada explícitamente.")
        return

    try:
        client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=2.0,
            socket_timeout=2.0,
        )
        await client.ping()
        _redis_client = client
        logger.info("Conectado a Redis en %s", settings.REDIS_URL)
    except Exception as exc:
        _redis_client = None
        logger.warning(
            "No se pudo conectar a Redis (%s): %s -- la API sigue funcionando "
            "sin caché (degradación suave).",
            settings.REDIS_URL,
            exc,
        )


async def disconnect_cache() -> None:
    """Close the Redis connection cleanly at shutdown, if it was ever open."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception:
            logger.debug("Error cerrando la conexión a Redis (ignorado).", exc_info=True)
        finally:
            _redis_client = None


def is_connected() -> bool:
    """Whether the cache is currently usable (connected)."""
    return _redis_client is not None


async def get_json(key: str) -> Any | None:
    """Read a JSON value from the cache. Returns None on miss OR on any Redis
    failure -- callers treat both identically (fall through to computing the
    real value), which is exactly the degradation the module promises."""
    if _redis_client is None:
        return None
    try:
        raw = await _redis_client.get(key)
    except Exception:
        logger.warning("Fallo leyendo de Redis (key=%s); tratando como cache-miss.", key, exc_info=True)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Valor cacheado no es JSON válido (key=%s); tratando como cache-miss.", key)
        return None


async def set_json(key: str, value: Any, ttl: int | None) -> None:
    """Write a JSON-serializable value to the cache with an optional TTL (seconds).
    Best-effort: nunca lanza, un fallo de escritura en Redis no debe romper el request
    que ya calculó la respuesta real."""
    if _redis_client is None:
        return
    try:
        payload = json.dumps(value, ensure_ascii=False, default=str)
        if ttl is not None:
            await _redis_client.set(key, payload, ex=ttl)
        else:
            await _redis_client.set(key, payload)
    except Exception:
        logger.warning("Fallo escribiendo en Redis (key=%s); se ignora.", key, exc_info=True)


async def delete(*keys: str) -> None:
    """Delete one or more exact keys. Best-effort, no-op si no hay conexión."""
    if _redis_client is None or not keys:
        return
    try:
        await _redis_client.delete(*keys)
    except Exception:
        logger.warning("Fallo invalidando claves en Redis (%s); se ignora.", keys, exc_info=True)


async def delete_prefix(prefix: str) -> None:
    """Delete every key under `prefix` (SCAN + DELETE, no bloqueante -- a diferencia
    de KEYS, seguro de usar aunque el namespace crezca). Usado para invalidar caches
    con clave dinámica (ej. resolver_insumo por término, alertas por usuario) donde el
    escritor no conoce todas las claves individuales afectadas."""
    if _redis_client is None:
        return
    try:
        keys = [key async for key in _redis_client.scan_iter(match=f"{prefix}*")]
        if keys:
            await _redis_client.delete(*keys)
    except Exception:
        logger.warning("Fallo invalidando prefijo en Redis (%s*); se ignora.", prefix, exc_info=True)


async def get_or_set_json(
    key: str, ttl: int | None, compute: Callable[[], Awaitable[Any]]
) -> Any:
    """Cache-aside helper: intenta leer `key`; en cache-miss (o Redis caído) ejecuta
    `compute()`, cachea el resultado y lo devuelve. `compute` debe devolver algo
    JSON-serializable (dict/list de tipos primitivos)."""
    cached = await get_json(key)
    if cached is not None:
        return cached
    value = await compute()
    await set_json(key, value, ttl)
    return value
