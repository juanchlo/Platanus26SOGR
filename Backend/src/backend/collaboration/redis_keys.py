"""Esquema de keys Redis para el módulo de colaboración.

Convención de nombres:
  stock:{punto_id}                    → HASH  {insumo_id: cantidad_disponible}
  need:{need_id}                      → HASH  {insumo_id, qty_required, qty_covered, lat, lng, urgencia}
  needs:pending:{insumo_id}           → ZSET  {need_id: score=urgencia}  (solo necesidades no cubiertas)
  suppliers:{insumo_id}:{lat}:{lng}   → ZSET  {punto_id: score=distancia_metros}
  reservation:{uuid}                  → HASH  {need_id, punto_id, insumo_id, qty, estado}
  needs:by_punto:{punto_id}           → SET   {need_id, ...}  (qué necesidades atiende este punto)
  stream:resource_updates             → STREAM  (eventos de cambio de stock)
"""

import uuid


def stock_key(punto_id: str) -> str:
    return f"stock:{punto_id}"


def need_key(need_id: str) -> str:
    return f"need:{need_id}"


def pending_needs_key(insumo_id: str) -> str:
    """ZSET de necesidades pendientes para un tipo de insumo.

    Scored by urgencia (mayor urgencia = score más alto = sale primero con ZREVRANGE).
    CLAVE ANTI-FANOUT: un update de stock de insumo X solo toca este ZSET,
    no itera por toda la red.
    """
    return f"needs:pending:{insumo_id}"


def suppliers_key(insumo_id: str, lat: float, lng: float) -> str:
    """ZSET de nodos de apoyo con stock del insumo, ordenados por distancia al punto afectado.

    Se calcula una vez con PostGIS y se cachea; TTL de 10 min (nodos no se mueven frecuentemente).
    """
    return f"suppliers:{insumo_id}:{lat:.4f}:{lng:.4f}"


def reservation_key(reservation_id: str) -> str:
    return f"reservation:{reservation_id}"


def needs_by_punto_key(punto_id: str) -> str:
    return f"needs:by_punto:{punto_id}"


RESOURCE_UPDATES_STREAM = "stream:resource_updates"
SUPPLIERS_TTL_SECONDS = 600  # 10 minutos
NEED_TTL_SECONDS = 86400 * 7  # 7 días
