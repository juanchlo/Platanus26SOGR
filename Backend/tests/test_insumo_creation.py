"""Tests for dynamic resource creation and semantic deduplication."""

import pytest
from backend.domain.services.semantic_dedup_service import (
    SemanticDedupService,
    _normalize_string,
)
from backend.domain.services.llm_analysis_service import (
    _find_best_insumo_match,
    _rule_based_nlp_analysis,
)


def test_normalize_string():
    assert _normalize_string("  Agua Potable  ") == "agua potable"
    assert _normalize_string("Colchón") == "colchon"
    assert _normalize_string("VÍVERES") == "viveres"


@pytest.mark.asyncio
async def test_semantic_dedup_fallback_exact_and_substring():
    service = SemanticDedupService()
    existing = ["Agua Potable", "Alimentos no perecederos", "Colchonetas", "Medicamentos básicos"]

    # Exact normalized match
    res1 = await service.check_duplicate("agua potable", existing)
    assert res1.es_duplicado is True
    assert res1.recurso_equivalente == "Agua Potable"

    # Substring match (e.g. "Agua" inside "Agua Potable")
    res2 = await service.check_duplicate("Agua", existing)
    assert res2.es_duplicado is True
    assert res2.recurso_equivalente == "Agua Potable"

    # New unique resource
    res3 = await service.check_duplicate("Generadores Eléctricos", existing)
    assert res3.es_duplicado is False
    assert res3.recurso_equivalente is None


def test_find_best_insumo_match():
    catalog = ["Agua Embotellada", "Kits de Primeros Auxilios", "Cobijas Térmicas"]
    
    match1 = _find_best_insumo_match(["agua", "potable"], catalog, "Agua")
    assert match1 == "Agua Embotellada"

    match2 = _find_best_insumo_match(["medicamento", "primeros auxilios"], catalog, "Salud")
    assert match2 == "Kits de Primeros Auxilios"

    match3 = _find_best_insumo_match(["comida", "alimento"], catalog, "Alimentos")
    assert match3 == "Alimentos"


def test_rule_based_nlp_with_dynamic_catalog():
    catalog = ["Agua Mineral 5L", "Raciones Militares", "Botiquín Táctico"]
    testimonio = "Tenemos varias familias atrapadas sin agua potable ni comida por el derrumbe"
    
    result = _rule_based_nlp_analysis(testimonio, catalog)
    assert result.tipo == "Derrumbe / Deslizamiento"
    assert len(result.recursos_requeridos) >= 2
    
    nombres_sugeridos = [r.insumo_nombre for r in result.recursos_requeridos]
    assert "Agua Mineral 5L" in nombres_sugeridos
    assert "Raciones Militares" in nombres_sugeridos
