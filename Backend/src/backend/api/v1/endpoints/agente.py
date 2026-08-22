"""Agente coordinador de emergencias: consulta en lenguaje natural -> plan de acción,
usando tool_use de Claude sobre las tools SQL ya expuestas como endpoints GET del backend.
"""

import json
import logging
from typing import Any

import anthropic
import httpx
from fastapi import APIRouter, status

from backend.api.deps import RequireFieldOperator
from backend.core.config import settings
from backend.schemas.agente import AgenteConsultaRequest, AgenteConsultaResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agente", tags=["Agente de IA (Coordinador de Emergencias)"])

MODEL = "claude-sonnet-4-6"
MAX_TOOL_ROUNDS = 3

SYSTEM_PROMPT = (
    "Eres el coordinador de emergencias de Cali, Colombia. "
    "Tienes acceso a información en tiempo real sobre recursos disponibles, "
    "emergencias activas y planes de respuesta. "
    "Responde siempre en español, de forma clara y directa. "
    "Cuando des un plan de acción, sé específico: nombra los puntos de ayuda, "
    "las distancias y los recursos disponibles. "
    "No inventes datos — usa solo lo que te devuelvan las tools."
)

# ============================================================
# Tools: cada una llama a un endpoint GET que ya existe en el backend,
# no reimplementan ninguna lógica -- son wrappers HTTP de 1 a 1.
# ============================================================

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_estado_ciudad",
        "description": (
            "Obtiene el estado actual completo de Cali: puntos activos, misiones "
            "urgentes, déficit de insumos y nodos inactivos"
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_triage_emergencias",
        "description": (
            "Lista las emergencias activas ordenadas por prioridad de atención "
            "con explicación del porqué"
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_plan_emergencia",
        "description": (
            "Devuelve el plan greedy de respuesta para una emergencia específica: "
            "qué nodos de ayuda responden, en qué orden y cuántos recursos tienen disponibles"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nodo_afectado_id": {
                    "type": "string",
                    "description": "UUID del nodo_afectado a atender (se obtiene de get_triage_emergencias).",
                }
            },
            "required": ["nodo_afectado_id"],
        },
    },
    {
        "name": "consultar_recurso",
        "description": (
            "Resuelve sinónimos de insumos. Ej: 'agua potable' → 'agua'. "
            "Usar antes de registrar cualquier recurso"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nombre": {"type": "string", "description": "Nombre libre del insumo a resolver."}
            },
            "required": ["nombre"],
        },
    },
    {
        "name": "consultar_inventario_punto",
        "description": (
            "Consulta el inventario detallado de un punto de control específico por nombre. "
            "Devuelve qué insumos tiene, el nivel actual y el déficit de cada uno."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "punto_nombre": {
                    "type": "string",
                    "description": "Nombre (o parte del nombre) del punto de control a consultar, ej. 'Cruz Roja'.",
                }
            },
            "required": ["punto_nombre"],
        },
    },
]


async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
    """GET a un endpoint propio del backend (las tools son wrappers 1:1 de la API pública)."""
    async with httpx.AsyncClient(base_url=settings.INTERNAL_API_BASE_URL, timeout=15.0) as client:
        response = await client.get(path, params=params)
        response.raise_for_status()
        return response.json()


async def _consultar_inventario_punto(punto_nombre: str) -> dict[str, Any]:
    """Busca un punto_control por nombre (parcial, case-insensitive) y trae su inventario real.

    El pedido original sugería GET /inventario/{punto_id} o, si no existiera, una query directa
    a Supabase contra inventario_con_deficit. Ninguna hace falta: el endpoint real ya existe --
    GET /puntos-control/{punto_id}/inventario (ver puntos_control.py) -- y devuelve exactamente
    nombre/nivel/cantidad_actual/cantidad_necesaria/deficit por insumo. Se reusa ese, en vez de
    abrir una conexión a la base de datos desde este endpoint (todas las demás tools son wrappers
    HTTP puros, sin acceso directo a Supabase, y mezclar los dos estilos acá rompería eso).
    """
    puntos = await _get("/puntos-control")
    nombre_normalizado = punto_nombre.strip().lower()
    matches = [p for p in puntos if nombre_normalizado in (p.get("nombre") or "").lower()]

    if not matches:
        return {"punto_nombre": punto_nombre, "encontrado": False, "inventario": []}

    punto = matches[0]
    inventario = await _get(f"/puntos-control/{punto['id']}/inventario")

    return {
        "punto_nombre": punto["nombre"],
        "punto_id": punto["id"],
        "encontrado": True,
        "otros_puntos_que_tambien_matchean": [p["nombre"] for p in matches[1:]],
        "inventario": [
            {
                "insumo": item["nombre"],
                "nivel": item["nivel"],
                "cantidad_actual": item.get("cantidad_actual"),
                "cantidad_necesaria": item.get("cantidad_necesaria"),
                "deficit": item.get("deficit"),
            }
            for item in inventario
        ],
    }


async def _dispatch_tool(name: str, tool_input: dict[str, Any]) -> Any:
    """Ejecuta la tool pedida por el modelo llamando al endpoint GET correspondiente."""
    if name == "get_estado_ciudad":
        return await _get("/ciudad/estado")
    if name == "get_triage_emergencias":
        return await _get("/nodos-afectados")
    if name == "get_plan_emergencia":
        return await _get(f"/nodos-afectados/{tool_input['nodo_afectado_id']}/plan")
    if name == "consultar_recurso":
        return await _get("/recursos/consultar", params={"nombre": tool_input["nombre"]})
    if name == "consultar_inventario_punto":
        return await _consultar_inventario_punto(tool_input["punto_nombre"])
    raise ValueError(f"Tool desconocida: {name}")


def _extract_text(response: anthropic.types.Message) -> str:
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return text or "No se pudo generar una respuesta a partir de la información disponible."


async def run_agente(consulta: str) -> AgenteConsultaResponse:
    """Corre el loop agentic manual: hasta MAX_TOOL_ROUNDS rondas de tool_use, después
    una llamada final sin tools para forzar una respuesta en texto."""
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    messages: list[dict[str, Any]] = [{"role": "user", "content": consulta}]
    tools_usadas: list[str] = []

    response = None
    for _ in range(MAX_TOOL_ROUNDS):
        response = await client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason != "tool_use":
            return AgenteConsultaResponse(respuesta=_extract_text(response), tools_usadas=tools_usadas)

        messages.append({"role": "assistant", "content": response.content})

        tool_use_blocks = [b for b in response.content if b.type == "tool_use"]
        tool_results = []
        for block in tool_use_blocks:
            tools_usadas.append(block.name)
            try:
                result = await _dispatch_tool(block.name, block.input)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    }
                )
            except Exception as exc:
                logger.warning("Fallo ejecutando tool %s: %s", block.name, exc)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Error consultando {block.name}: {exc}",
                        "is_error": True,
                    }
                )

        messages.append({"role": "user", "content": tool_results})

    # Se agotaron las MAX_TOOL_ROUNDS rondas: forzar respuesta final sin tools
    # (así el modelo no puede seguir pidiendo tool_use y el loop siempre termina).
    final_response = await client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return AgenteConsultaResponse(respuesta=_extract_text(final_response), tools_usadas=tools_usadas)


@router.post(
    "/consultar",
    response_model=AgenteConsultaResponse,
    status_code=status.HTTP_200_OK,
    summary="Consultar al Agente Coordinador de Emergencias",
    description=(
        "Recibe una consulta en lenguaje natural del operador y responde con un plan de "
        "acción concreto, llamando (hasta 3 rondas) a las tools SQL ya expuestas como "
        "endpoints GET del backend."
    ),
)
async def consultar_agente(
    payload: AgenteConsultaRequest,
    current_user: RequireFieldOperator,
) -> AgenteConsultaResponse:
    """Run the emergency-coordination agent for one operator query."""
    return await run_agente(payload.consulta)
