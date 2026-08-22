"""SOGR - Realtime: guia de integracion entre las piezas del equipo.

Backend 1 (Kta) dejo listo en Backend/supabase/:
  - realtime.sql   -> ALTER PUBLICATION sobre inventario/necesidades/puntos_control
                       + funcion alertas_nodos_inactivos()
  - postgis.sql    -> funciones puntos_cercanos() / necesidades_en_zona()
  - pgrouting.sql  -> funciones ruta_optima() / misiones_priorizadas()

Este archivo no implementa nada nuevo del lado de Python: es la
referencia que conecta esas piezas con el resto del stack.
  a) Como Frontend (Sam/David, Next.js) se suscribe a los canales.
  b) El schema exacto del mensaje que reciben cuando cambia inventario.
  c) Como Backend 2 (Juan, FastAPI) expone alertas_nodos_inactivos()
     como endpoint.
  d) Cuando usar Supabase Realtime vs WebSockets/SSE propios en SOGR.

Es codigo Python valido (se puede `import realtime_config` sin efectos
secundarios), pero su valor esta en los comentarios y las constantes
de ejemplo, no en logica ejecutable de produccion.
"""

# ============================================================
# a) Suscripcion desde Next.js (Frontend 1/2 - Sam, David)
# ============================================================
#
# Supabase Realtime en modo "postgres_changes" escucha directo el
# replication slot de Postgres: no hace falta que FastAPI emita nada,
# el cliente JS se conecta al proyecto Supabase y listo. Requiere el
# anon key publico (no el service_role key) en el cliente.
#
# npm install @supabase/supabase-js
#
NEXTJS_SUBSCRIPTION_EXAMPLE = """
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Stock de un punto de control especifico (ej. pantalla de un albergue)
const inventarioChannel = supabase
  .channel('inventario-changes')
  .on(
    'postgres_changes',
    {
      event: '*',               // INSERT | UPDATE | DELETE, o '*' para todos
      schema: 'public',
      table: 'inventario',
      filter: `punto_id=eq.${puntoId}`,   // opcional: solo este punto
    },
    (payload) => {
      // ver seccion (b) para la forma exacta de `payload`
      actualizarStockEnUI(payload)
    }
  )
  .subscribe()

// Alertas criticas (RF-16): nuevas necesidades o cambios de estado
const necesidadesChannel = supabase
  .channel('necesidades-changes')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'necesidades' },
    (payload) => mostrarAlertaCritica(payload)
  )
  .subscribe()

// Saturacion / cierre de un centro (RF-08, RF-16)
const puntosChannel = supabase
  .channel('puntos-control-changes')
  .on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'puntos_control' },
    (payload) => actualizarMarcadorEnMapa(payload)
  )
  .subscribe()

// Al desmontar el componente:
// supabase.removeChannel(inventarioChannel)
"""

# ============================================================
# b) Schema del mensaje que llega al cliente (para Sam y David)
# ============================================================
#
# Cada evento de postgres_changes trae este `payload` (mismo shape
# para las 3 tablas, cambia el contenido de new/old):
#
# {
#   "schema": "public",
#   "table": "inventario",
#   "commit_timestamp": "2026-08-22T14:32:10.123Z",
#   "eventType": "UPDATE",              // "INSERT" | "UPDATE" | "DELETE"
#   "new": {                            // fila completa post-cambio (vacio en DELETE)
#     "punto_id": "b6e2...uuid",
#     "insumo_id": "9a41...uuid",
#     "nivel": "poco",
#     "actualizado_en": "2026-08-22T14:32:10.1+00:00",
#     "actualizado_por": "2f10...uuid"
#   },
#   "old": {},                          // fila previa (vacia salvo que la tabla
#                                        // tenga REPLICA IDENTITY FULL; por defecto
#                                        // Postgres solo manda la PK en `old`)
#   "errors": null
# }
#
# Notas para el frontend:
# - `nivel` es el campo que dispara UI (badge de color, barra de stock).
#   No viene `nombre_insumo` ni `nombre` del punto: el payload es la fila
#   cruda de `inventario`, hay que resolver esos nombres con lo que ya
#   tengan cacheado en el store, o pedirlo aparte.
# - Para necesidades, el campo relevante para alertas es `estado` y
#   `urgencia` dentro de `new`.
# - Para puntos_control, el campo relevante es `estado` (saturado/cerrado).
EXAMPLE_INVENTARIO_UPDATE_PAYLOAD = {
    "schema": "public",
    "table": "inventario",
    "commit_timestamp": "2026-08-22T14:32:10.123Z",
    "eventType": "UPDATE",
    "new": {
        "punto_id": "b6e2f1a0-0000-0000-0000-000000000001",
        "insumo_id": "9a41c2b0-0000-0000-0000-000000000002",
        "nivel": "poco",
        "actualizado_en": "2026-08-22T14:32:10.1+00:00",
        "actualizado_por": "2f10ab30-0000-0000-0000-000000000003",
    },
    "old": {},
    "errors": None,
}

# ============================================================
# c) FastAPI expone alertas_nodos_inactivos() (Backend 2 - Juan)
# ============================================================
#
# alertas_nodos_inactivos() ya devuelve JSON armado (convencion del
# equipo: las funciones SQL arman su propia respuesta, FastAPI no
# transforma nada, solo la reenvia). Ejemplo de endpoint:
#
# Backend/src/backend/api/v1/endpoints/alertas.py
#
FASTAPI_ENDPOINT_EXAMPLE = '''
"""Alertas de monitoreo de nodos (RF-17)."""

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import DatabaseSession

router = APIRouter(prefix="/alertas", tags=["Alertas"])


@router.get("/nodos-inactivos", summary="Puntos de control sin reporte de inventario hace +2h")
async def get_nodos_inactivos(db: DatabaseSession):
    result = await db.execute(text("SELECT alertas_nodos_inactivos()"))
    raw_json: str = result.scalar_one()

    # asyncpg devuelve columnas `json`/`jsonb` como texto crudo, no como
    # dict de Python. FastAPI puede reenviarlo tal cual con Response en
    # vez de json.loads() + re-serializar (evita un parseo redundante):
    from fastapi import Response
    return Response(content=raw_json, media_type="application/json")
'''
#
# Despues, en api/v1/router.py agregar:
#   from backend.api.v1.endpoints.alertas import router as alertas_router
#   api_router.include_router(alertas_router)
#
# Mismo patron aplica para puntos_cercanos(), necesidades_en_zona(),
# ruta_optima() y misiones_priorizadas() (postgis.sql / pgrouting.sql):
# todas devuelven `json` ya armado, se consumen igual.

# ============================================================
# d) Supabase Realtime vs WebSockets/SSE propios - cuando usar cada uno
# ============================================================
#
# Supabase Realtime (postgres_changes):
#   - Escucha el WAL de Postgres (logical replication) y reenvia cambios
#     de fila tal cual quedaron en la tabla. Cero codigo de backend.
#   - Sirve para: "esta fila cambio" (inventario, necesidades,
#     puntos_control ya cubiertos en este archivo).
#   - NO sirve para: eventos que necesitan calculo antes de emitirse.
#     alertas_nodos_inactivos(), misiones_priorizadas() y ruta_optima()
#     son funciones que alguien tiene que *invocar* (via Celery beat o
#     un endpoint) - Realtime no las dispara solo porque haya pasado
#     tiempo, porque no hay ninguna fila cambiando.
#
# WebSockets/SSE propios (FastAPI):
#   - Necesarios cuando el evento es *derivado*, no un cambio de fila:
#     ej. "se detecto un nodo inactivo" (RF-17) o "se armo una mision
#     prioritaria" (RF-08). El flujo tipico seria: Celery beat corre
#     alertas_nodos_inactivos()/misiones_priorizadas() cada N minutos,
#     y si hay resultados nuevos los empuja por un WebSocket/SSE propio
#     (o los inserta en una tabla tipo `alertas` que si este en la
#     publicacion de Realtime, para no reinventar el transporte).
#   - Tambien aplica si se necesita logica de autorizacion por mensaje
#     mas fina que RLS (ej. un operador de campo que solo debe ver
#     alertas de su zona asignada).
#
# Para SOGR, la regla practica: si el dato ya vive en una tabla y el
# cambio es visible con un SELECT normal -> Realtime. Si hace falta
# *calcular* algo primero -> Celery + (WebSocket/SSE o tabla puente
# que sí esté en Realtime). Esa pieza (el scheduler de Celery que
# corre alertas_nodos_inactivos()) es de Backend 2, no la implemento
# aca.
