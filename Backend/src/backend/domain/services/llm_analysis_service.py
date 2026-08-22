"""Service for AI/LLM analysis of field operator testimonies and resource matching."""

import json
import logging
import os
import re
from typing import Optional

from backend.schemas.incidente import IncidentAnalysisResult, RecursoSugerido

logger = logging.getLogger(__name__)

# Known Cali sectors and neighborhoods
CALI_SECTORS = [
  "Siloé", "Terrón Colorado", "San Fernando", "Meléndez", "Aguablanca",
  "Alfonso López", "El Peñón", "Granada", "Centenario", "Ciudad Jardín",
  "La Flora", "Salomia", "Los Alcázares", "San Antonio", "Comuna 20",
  "Comuna 18", "Comuna 13", "Comuna 7", "Comuna 1", "Comuna 3"
]


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
            insumo_nombre="Agua Potable",
            cantidad_estimada=250,
            unidad="litros",
            razon="Suministro de hidratación para familias y personal de respuesta.",
        ))
        
    # Alimentos
    if any(w in lower for w in ["comida", "alimento", "hambre", "nutricion", "racion", "vituall"]):
        recursos.append(RecursoSugerido(
            insumo_nombre="Alimentos y Raciones",
            cantidad_estimada=120,
            unidad="raciones",
            razon="Alimentación de emergencia para personas damnificadas.",
        ))

    # Salud / Medicamentos
    if any(w in lower for w in ["herid", "medic", "curacion", "suero", "botiquin", "vend", "alcohol", "analgesic"]):
        recursos.append(RecursoSugerido(
            insumo_nombre="Medicamentos y Primeros Auxilios",
            cantidad_estimada=40,
            unidad="kits",
            razon="Atención primaria prehospitalaria y estabilización de lesionados.",
        ))
        recursos.append(RecursoSugerido(
            insumo_nombre="Suero Oral",
            cantidad_estimada=60,
            unidad="unidades",
            razon="Rehidratación médica para niños y adultos mayores.",
        ))

    # Abrigo / Colchonetas
    if any(w in lower for w in ["colchoneta", "cobija", "frio", "mojad", "dormir", "albergue", "manta", "abrigo", "sin techo"]):
        recursos.append(RecursoSugerido(
            insumo_nombre="Colchonetas y Abrigo",
            cantidad_estimada=50,
            unidad="unidades",
            razon="Acondicionamiento para refugio temporal y aislamiento térmico.",
        ))

    # Aseo
    if any(w in lower for w in ["aseo", "higiene", "jabon", "bano", "toalla"]):
        recursos.append(RecursoSugerido(
            insumo_nombre="Kits de Aseo e Higiene",
            cantidad_estimada=30,
            unidad="kits",
            razon="Prevención de vectores y salubridad básica.",
        ))

    # Default fallback if no specific supply detected
    if not recursos:
        recursos.append(RecursoSugerido(
            insumo_nombre="Agua Potable",
            cantidad_estimada=100,
            unidad="litros",
            razon="Asignación preventiva estándar para incidentes en terreno.",
        ))
        recursos.append(RecursoSugerido(
            insumo_nombre="Kits de Primeros Auxilios",
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
        f"**Diagnóstico IA (SOGR):** Reporte de tipo *{tipo}* evaluado con prioridad **{urgencia}/5**. "
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
    """Service utilizing Gemini API with resilient NLP fallback to analyze emergency reports."""

    def __init__(self) -> None:
        self.api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

    async def analyze_incident_testimony(
        self,
        testimonio: str,
        available_insumos: list[str],
        lat: float,
        lng: float,
        barrio_context: Optional[str] = None,
    ) -> IncidentAnalysisResult:
        """Analyze testimony using Gemini API (if key present) or heuristic engine."""
        if not self.api_key:
            return _rule_based_nlp_analysis(testimonio, available_insumos)

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=self.api_key)
            prompt = f"""
            Eres el agente orquestador SOGR de la Alcaldía de Cali, Colombia.
            Un operador de campo o autoridad acaba de transmitir el siguiente testimonio desde el terreno en las coordenadas ({lat}, {lng}):

            TESTIMONIO:
            "{testimonio}"

            CATÁLOGO DE INSUMOS DISPONIBLES EN LA RED DE CALI:
            {', '.join(available_insumos) if available_insumos else 'Agua Potable, Alimentos y Raciones, Medicamentos y Primeros Auxilios, Suero Oral, Colchonetas y Abrigo, Kits de Aseo'}

            BARRIO / ZONA (SI APLICA): {barrio_context or 'Cali'}

            INSTRUCCIONES:
            1. Determina la categoría principal del incidente (ej. "Derrumbe / Deslizamiento", "Inundación", "Incendio", "Emergencia Médica", "Desabastecimiento").
            2. Evalúa el nivel de urgencia/prioridad sugerido del 1 al 5 (5 = Riesgo inminente de vidas, 4 = Alta severidad, 3 = Media, 2 = Menor, 1 = Baja).
            3. Compara y selecciona los insumos necesarios de la red de ayuda y estima las cantidades requeridas con su unidad y justificación.
            4. Redacta un diagnóstico conciso de situación y riesgo.
            5. Si se menciona un barrio o comuna de Cali en el testimonio, extráelo.
            """

            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=IncidentAnalysisResult,
                    temperature=0.1,
                ),
            )

            if response.text:
                data = json.loads(response.text)
                return IncidentAnalysisResult.model_validate(data)
        except Exception as e:
            logger.warning(f"Error calling Gemini API: {e}. Utilizing built-in NLP engine.")

        return _rule_based_nlp_analysis(testimonio, available_insumos)
