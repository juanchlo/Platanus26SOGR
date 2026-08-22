"""Pydantic schemas for Nodos Afectados, triage, and emergency response planning."""

from datetime import datetime
from typing import Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field


class NodoAfectadoCreate(BaseModel):
    """Schema for reporting a new affected node / emergency."""

    titulo: str = Field(..., min_length=3, description="Título breve de la emergencia.")
    descripcion: str = Field(..., min_length=3, description="Descripción detallada de lo que está pasando.")
    necesidad: str = Field(..., min_length=3, description="Qué se necesita, en texto libre (ej. 'Agua, ambulancias, médicos').")
    lat: float = Field(..., description="Latitud del nodo afectado.")
    lng: float = Field(..., description="Longitud del nodo afectado.")
    severidad: int = Field(3, ge=1, le=5, description="Severidad de la emergencia (1 a 5).")
    personas_afectadas: int = Field(0, ge=0, description="Cantidad estimada de personas afectadas.")


class NodoAfectadoResponse(BaseModel):
    """Schema representing a created/stored affected node, con barrio geocodificado por trigger."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    titulo: str
    descripcion: str
    necesidad: str
    lat: float
    lng: float
    severidad: int
    personas_afectadas: int
    estado: str
    barrio: Optional[str] = None
    creado_por: Optional[uuid.UUID] = None
    creado_en: Optional[datetime] = None
    actualizado_en: Optional[datetime] = None


class TriageActivoItem(BaseModel):
    """Schema representing one entry of the active-emergency triage list (tool_triage_activo)."""

    orden: int
    id: uuid.UUID
    titulo: str
    score: float
    razon_prioridad: str


class CandidatoAyuda(BaseModel):
    """Schema representing one candidate punto_control in a greedy assignment cascade."""

    orden: int
    nombre: str
    distancia_km: float
    insumos_disponibles: list[str] = []
    nivel_disponibilidad_pct: float
    accion: str


class PlanAyudaResponse(BaseModel):
    """Schema representing the full greedy assignment plan for an affected node (asignar_ayuda)."""

    nodo_afectado_id: uuid.UUID
    radio_km: Optional[float] = None
    disponibilidad_acumulada_pct: Optional[float] = None
    candidatos: list[CandidatoAyuda] = []
    error: Optional[str] = None


class NodoAfectadoDetalleResponse(NodoAfectadoResponse):
    """NodoAfectadoResponse + el plan que el trigger generar_plan_respuesta_nodo_afectado()
    (Backend/supabase/plan_respuesta_nodo_afectado.sql) guardó al crearse el nodo -- una
    foto fija del momento del INSERT, distinta del plan en vivo de /{id}/plan."""

    nodos_ayuda_asignados: Optional[list[CandidatoAyuda]] = None
    plan_respuesta: Optional[str] = None
