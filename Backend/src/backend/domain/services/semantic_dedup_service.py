import json
import logging
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from anthropic import AsyncAnthropic

from backend.core.config import settings

logger = logging.getLogger(__name__)

class SemanticDedupResult(BaseModel):
    es_duplicado: bool
    recurso_equivalente: str | None
    confianza: float

def _normalize_string(s: str) -> str:
    import unicodedata
    s = s.lower().strip()
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')

async def check_semantic_duplication(
    nombre_propuesto: str,
    nombres_existentes: list[str],
    db: Optional[AsyncSession] = None
) -> SemanticDedupResult:
    """
    Checks if a proposed new resource name is semantically equivalent to any existing resource in the catalog.
    """
    api_key = getattr(settings, "ANTHROPIC_API_KEY", getattr(settings, "CLAUDE_API_KEY", None))
    
    if api_key:
        models_to_try = [
            "claude-sonnet-4-6",
            "claude-haiku-4-5-20251001",
            "claude-sonnet-4-5-20250929",
        ]
        client = AsyncAnthropic(api_key=api_key)
        prompt = f"""
        Eres un experto en logística de socorro, emergencias y gestión del riesgo (PULSE) en Colombia.
        Tu tarea es determinar si un insumo propuesto a ingresar es SEMÁNTICAMENTE EQUIVALENTE, un SINÓNIMO, una FÓRMULA QUÍMICA (ej. H2O / H20 = agua), o el MISMO RECURSO LOGÍSTICO que alguno de los existentes en el catálogo.

        Criterios de equivalencia en socorro y emergencias:
        - 'Planta eléctrica', 'generador eléctrico', 'generador de energía', 'grupo electrógeno', 'motogenerador' son el MISMO recurso logístico (Generación eléctrica).
        - 'H2O', 'H20', 'agua mineral', 'agua en bolsa', 'agua embotellada', 'agua potable', 'hidratación' son el MISMO recurso logístico (Agua).
        - 'Cobija', 'frazada', 'manta', 'ruana', 'abrigador' son el MISMO recurso (Cobijas / Abrigo).
        - 'Colchoneta', 'colchón', 'cama plegable', 'sleeping' son el MISMO recurso (Colchonetas).
        - 'Comida', 'víveres', 'mercado', 'alimento no perecedero', 'enlatados', 'provisiones' son el MISMO recurso (Alimentos).
        - 'Linterna', 'foco', 'lámpara de emergencia', 'linterna frontal' son el MISMO recurso (Linternas).
        - 'Medicinas', 'fármacos', 'pastillas', 'primeros auxilios' son el MISMO recurso (Medicamentos).

        Insumo propuesto: "{nombre_propuesto}"
        Catálogo actual existente: {json.dumps(nombres_existentes)}

        ¿El insumo propuesto ya está cubierto semánticamente por alguno de los insumos existentes?
        Responde ÚNICAMENTE con un JSON válido:
        {{"es_duplicado": true, "recurso_equivalente": "<nombre exacto del elemento del catálogo>", "confianza": 0.95}}
        o si es un recurso genuinamente nuevo y no cubierto:
        {{"es_duplicado": false, "recurso_equivalente": null, "confianza": 1.0}}
        """

        for model_name in models_to_try:
            try:
                response = await client.messages.create(
                    model=model_name,
                    max_tokens=256,
                    messages=[{"role": "user", "content": prompt}]
                )
                content = response.content[0].text
                start = content.find('{')
                end = content.rfind('}') + 1
                if start != -1 and end != 0:
                    result_dict = json.loads(content[start:end])
                    return SemanticDedupResult(
                        es_duplicado=bool(result_dict.get("es_duplicado", False)),
                        recurso_equivalente=result_dict.get("recurso_equivalente"),
                        confianza=float(result_dict.get("confianza", 1.0)),
                    )
            except Exception as model_err:
                logger.warning(f"Error con modelo {model_name} en deduplicación semántica: {model_err}")
                continue

    # Fallback 1: Database synonym resolver if DB session is available
    if db:
        try:
            result = await db.execute(
                text("SELECT i.nombre FROM insumos i WHERE i.id = resolver_insumo(:nombre)"),
                {"nombre": nombre_propuesto}
            )
            canonico = result.scalar_one_or_none()
            if canonico:
                return SemanticDedupResult(es_duplicado=True, recurso_equivalente=canonico, confianza=0.95)
        except Exception as e:
            logger.debug(f"Error consultando resolver_insumo: {e}")

    # Fallback 2: Local string normalization and heuristics
    norm_propuesto = _normalize_string(nombre_propuesto)
    # Simple plural stripping in Spanish
    stem_propuesto = norm_propuesto[:-2] if norm_propuesto.endswith("es") else (norm_propuesto[:-1] if norm_propuesto.endswith("s") else norm_propuesto)

    for existente in nombres_existentes:
        norm_existente = _normalize_string(existente)
        stem_existente = norm_existente[:-2] if norm_existente.endswith("es") else (norm_existente[:-1] if norm_existente.endswith("s") else norm_existente)

        if (
            norm_propuesto == norm_existente
            or stem_propuesto == stem_existente
            or (len(norm_propuesto) >= 4 and norm_propuesto in norm_existente)
            or (len(norm_existente) >= 4 and norm_existente in norm_propuesto)
        ):
            return SemanticDedupResult(es_duplicado=True, recurso_equivalente=existente, confianza=0.85)

    return SemanticDedupResult(es_duplicado=False, recurso_equivalente=None, confianza=1.0)

class SemanticDedupService:
    async def check_duplicate(
        self,
        nombre_propuesto: str,
        nombres_existentes: list[str],
        db: Optional[AsyncSession] = None
    ) -> SemanticDedupResult:
        return await check_semantic_duplication(nombre_propuesto, nombres_existentes, db)
