"""Service for AI/LLM analysis of field operator testimonies and resource matching using Claude (Anthropic)."""

import json
import logging
import os
import re
from typing import Optional

from backend.core.config import settings
from backend.schemas.incidente import IncidentAnalysisResult, RecursoSugerido

logger = logging.getLogger(__name__)

# Known Cali sectors and neighborhoods
CALI_SECTORS = [
    "Siloé", "Terrón Colorado", "San Fernando", "Meléndez", "Aguablanca",
    "Alfonso López", "El Peñón", "Granada", "Centenario", "Ciudad Jardín",
    "La Flora", "Salomia", "Los Alcázares", "San Antonio", "Comuna 20",
    "Comuna 18", "Comuna 13", "Comuna 7", "Comuna 1", "Comuna 3"
]


def _find_best_insumo_match(keywords: list[str], available: list[str], default: str) -> str:
    """Finds the first insumo from available whose lowercase name contains any of the keywords."""
    for insumo in available:
        insumo_lower = insumo.lower()
        if any(kw in insumo_lower for kw in keywords):
            return insumo
    return default


def _rule_based_nlp_analysis(testimonio: str, available_insumos: list[str]) -> IncidentAnalysisResult:
    """Robust heuristic NLP fallback to parse emergency testimonies and match relief catalog."""
    lower = testimonio.lower()

    # 1. Determine Incident Type
    if any(w in lower for w in ["derrumbe", "deslizamiento", "grieta", "ladera", "tierra", "desmoron"]):
        tipo = "Derrumbe / Deslizamiento"
    elif any(w in lower for w in ["inundaci", "desbordamiento", "creciente", "rio", "lluvia", "canal", "alcantarill"]):
        tipo = "Inundación / Creciente Súbita"
    elif any(w in lower for w in ["incendio", "fuego", "humo", "llamas", "quema"]):
        tipo = "Incendio Estructural / Forestal"
    elif any(w in lower for w in ["herido", "fractura", "sangr", "atrapad", "asfixia", "inconsciente", "primeros auxilios", "ambulancia"]):
        tipo = "Emergencia Médica y Rescate"
    elif any(w in lower for w in ["colapso", "caida de arbol", "poste", "techo", "vivienda"]):
        tipo = "Colapso Estructural / Obstrucción Vial"
    elif any(w in lower for w in ["comida", "hambre", "alimento", "sed", "desabastec"]):
        tipo = "Desabastecimiento Humanitario"
    else:
        tipo = "Incidente de Gestión del Riesgo"

    # 2. Determine Urgency Priority (1 to 5)
    if any(w in lower for w in ["vida", "muert", "inminente", "atrapad", "asfixia", "grave", "urgente", "fuego descontrolado", "colapso total", "bebe", "embarazada"]):
        urgencia = 5
    elif any(w in lower for w in ["damnificad", "herid", "inundad", "sin techo", "evacua", "corte de agua", "10 famili", "20 famili", "15 famili"]):
        urgencia = 4
    elif any(w in lower for w in ["requiere", "afectad", "escasez", "revis", "apoyo", "monitoreo"]):
        urgencia = 3
    else:
        urgencia = 2

    # 3. Match Supplies & Estimate Quantities from Testimony
    recursos: list[RecursoSugerido] = []

    # Agua
    if any(w in lower for w in ["agua", "sed", "potable", "hidrataci", "deshidratad"]):
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["agua", "potable", "hidrat"], available_insumos, "Agua Potable"),
            cantidad_estimada=250,
            unidad="litros",
            razon="Suministro de hidratación para familias y personal de respuesta.",
        ))

    # Alimentos
    if any(w in lower for w in ["comida", "alimento", "hambre", "nutricion", "racion", "vituall"]):
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["alimento", "racion", "comida"], available_insumos, "Alimentos y Raciones"),
            cantidad_estimada=120,
            unidad="raciones",
            razon="Alimentación de emergencia para personas damnificadas.",
        ))

    # Salud / Medicamentos
    if any(w in lower for w in ["herid", "medic", "curacion", "suero", "botiquin", "vend", "alcohol", "analgesic"]):
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["medicamento", "primeros auxilios", "botiquin", "salud"], available_insumos, "Medicamentos y Primeros Auxilios"),
            cantidad_estimada=40,
            unidad="kits",
            razon="Atención primaria prehospitalaria y estabilización de lesionados.",
        ))
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["suero", "oral", "rehidrat"], available_insumos, "Suero Oral"),
            cantidad_estimada=60,
            unidad="unidades",
            razon="Rehidratación médica para niños y adultos mayores.",
        ))

    # Abrigo / Colchonetas
    if any(w in lower for w in ["colchoneta", "cobija", "frio", "mojad", "dormir", "albergue", "manta", "abrigo", "sin techo"]):
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["colchoneta", "abrigo", "manta", "cobija"], available_insumos, "Colchonetas y Abrigo"),
            cantidad_estimada=50,
            unidad="unidades",
            razon="Acondicionamiento para refugio temporal y aislamiento térmico.",
        ))

    # Aseo
    if any(w in lower for w in ["aseo", "higiene", "jabon", "bano", "toalla"]):
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["aseo", "higiene", "jabon"], available_insumos, "Kits de Aseo e Higiene"),
            cantidad_estimada=30,
            unidad="kits",
            razon="Prevención de vectores y salubridad básica.",
        ))

    # Default fallback if no specific supply detected
    if not recursos:
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["agua", "potable", "hidrat"], available_insumos, "Agua Potable"),
            cantidad_estimada=100,
            unidad="litros",
            razon="Asignación preventiva estándar para incidentes en terreno.",
        ))
        recursos.append(RecursoSugerido(
            insumo_nombre=_find_best_insumo_match(["primeros auxilios", "botiquin", "emergencia"], available_insumos, "Kits de Primeros Auxilios"),
            cantidad_estimada=20,
            unidad="kits",
            razon="Material básico de respuesta rápida.",
        ))

    # 4. Extract Barrio
    barrio_match = None
    for barrio in CALI_SECTORS:
        if barrio.lower() in lower:
            barrio_match = barrio
            break

    diagnostico = (
        f"**Diagnóstico IA (PULSE):** Reporte de tipo *{tipo}* evaluado con prioridad **{urgencia}/5**. "
        f"Se identificó demanda inmediata de {len(recursos)} categorías de recursos críticos. "
        f"Nivel de riesgo {'CRÍTICO: compromete integridad física' if urgencia >= 4 else 'MODERADO: requiere mitigación logística'}."
    )

    return IncidentAnalysisResult(
        tipo=tipo,
        urgencia=urgencia,
        diagnostico=diagnostico,
        recursos_requeridos=recursos,
        barrio_sugerido=barrio_match,
    )


class LLMAnalysisService:
    """Service utilizing Anthropic Claude API with resilient NLP fallback to analyze emergency reports."""

    def __init__(self) -> None:
        self.api_key = (
            settings.ANTHROPIC_API_KEY
            or settings.CLAUDE_API_KEY
            or os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("CLAUDE_API_KEY")
        )
        if self.api_key and self.api_key.startswith("your_anthropic"):
            self.api_key = None

    async def analyze_incident_testimony(
        self,
        testimonio: str,
        available_insumos: list[str],
        lat: float,
        lng: float,
        barrio_context: Optional[str] = None,
        available_insumos_detail: list[dict] | None = None,
    ) -> IncidentAnalysisResult:
        """Analyze testimony using Anthropic Claude API or heuristic engine."""
        if not self.api_key:
            return _rule_based_nlp_analysis(testimonio, available_insumos)

        try:
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=self.api_key)
            
            if available_insumos_detail:
                catalog_str = "\\n".join([f"{i}. {item['nombre']} ({item.get('categoria', '')}, {item.get('unidad', '')})" for i, item in enumerate(available_insumos_detail, 1)])
            else:
                catalog_str = ', '.join(available_insumos) if available_insumos else 'Agua Potable, Alimentos y Raciones, Medicamentos y Primeros Auxilios, Suero Oral, Colchonetas y Abrigo, Kits de Aseo'

            prompt = f"""
            Eres el agente orquestador PULSE (Plataforma de Unificación y Lógica de Seguridad en Emergencias) de la Alcaldía de Cali, Colombia.
            Un operador de campo o autoridad acaba de transmitir el siguiente testimonio desde el terreno en las coordenadas ({lat}, {lng}):

            TESTIMONIO:
            "{testimonio}"

            CATÁLOGO DE INSUMOS DISPONIBLES EN LA RED DE CALI:
            {catalog_str}

            BARRIO / ZONA (SI APLICA): {barrio_context or 'Cali'}

            INSTRUCCIONES:
            1. Determina la categoría principal del incidente (ej. "Derrumbe / Deslizamiento", "Inundación / Creciente Súbita", "Incendio Estructural / Forestal", "Emergencia Médica y Rescate", "Desabastecimiento Humanitario").
            2. Evalúa el nivel de urgencia/prioridad sugerido del 1 al 5 (5 = Riesgo inminente de vidas, 4 = Alta severidad, 3 = Media, 2 = Menor, 1 = Baja).
            3. Selecciona ÚNICAMENTE insumos del CATÁLOGO proporcionado arriba. El campo "insumo_nombre" de cada recurso DEBE ser exactamente uno de los nombres listados en el catálogo. NO inventes nombres nuevos ni uses variantes. Si ningún recurso del catálogo aplica exactamente, usa el más cercano disponible.
            4. Selecciona los insumos necesarios de la red de ayuda y estima las cantidades requeridas con su unidad y justificación.
            5. Redacta un diagnóstico conciso de situación y riesgo.
            6. Si se menciona un barrio o comuna de Cali en el testimonio, extráelo en "barrio_sugerido".

            IMPORTANTE: Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura (sin texto adicional fuera del JSON):
            {{
              "tipo": "string",
              "urgencia": 1-5,
              "diagnostico": "string",
              "recursos_requeridos": [
                {{
                  "insumo_nombre": "string",
                  "cantidad_estimada": number,
                  "unidad": "string",
                  "razon": "string"
                }}
              ],
              "barrio_sugerido": "string o null"
            }}
            """

            try:
                response = await client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=1024,
                    system="Eres un asistente experto en emergencias y logística de socorro para Cali, Colombia. Responde estrictamente en formato JSON válido. Sé conciso y preciso: diagnósticos cortos, cantidades realistas, sin texto innecesario.",
                    messages=[
                        {"role": "user", "content": prompt}
                    ],
                )
            except Exception as model_err:
                logger.info(f"Probando modelo fallback Claude Haiku: {model_err}")
                response = await client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=1024,
                    system="Eres un asistente experto en emergencias y logística de socorro para Cali, Colombia. Responde estrictamente en formato JSON válido. Sé conciso y preciso: diagnósticos cortos, cantidades realistas, sin texto innecesario.",
                    messages=[
                        {"role": "user", "content": prompt}
                    ],
                )

            # Extract message content
            text_blocks = [block.text for block in response.content if hasattr(block, "text")]
            full_text = "\n".join(text_blocks).strip()

            # Clean json codeblocks if any
            if "```json" in full_text:
                full_text = full_text.split("```json")[1].split("```")[0].strip()
            elif "```" in full_text:
                full_text = full_text.split("```")[1].split("```")[0].strip()

            data = json.loads(full_text)
            return IncidentAnalysisResult.model_validate(data)
        except Exception as e:
            logger.warning(f"Error llamando a Anthropic Claude API: {e}. Utilizando motor NLP de contingencia.")

        return _rule_based_nlp_analysis(testimonio, available_insumos)
