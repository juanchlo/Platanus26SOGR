"""Pydantic schemas for Incidentes, Operator Testimonies, and AI-driven Resource Assessment."""

from datetime import datetime
import json
from typing import Any, Literal, Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field


class RecursoSugerido(BaseModel):
    """Schema for a specific supply or relief item recommended by the AI."""

    insumo_nombre: str
    cantidad_estimada: int = 50
    unidad: str = "unidades"
    razon: str = "Requerido para atención inmediata según testimonio."


class IncidentAnalysisResult(BaseModel):
    """Structured response from LLM analyzing operator testimony."""

    tipo: str = "Emergencia / Incidente"
    urgencia: int = 3
    diagnostico: str
    recursos_requeridos: list[RecursoSugerido] = []
    barrio_sugerido: Optional[str] = None


class IncidenteCreate(BaseModel):
    """Schema for submitting a field operator incident report."""

    testimonio: str = Field(
        ...,
        min_length=5,
        description="Testimonio de voz o texto del operador en terreno describiendo la emergencia.",
    )
    lat: float = Field(..., description="Latitud (geolocalización del operador o punto en mapa).")
    lng: float = Field(..., description="Longitud (geolocalización del operador o punto en mapa).")
    direccion: Optional[str] = Field(None, description="Dirección aproximada o punto de referencia en Cali.")
    barrio: Optional[str] = Field(None, description="Barrio o comuna en Cali.")
    urgencia_manual: Optional[int] = Field(
        None,
        ge=1,
        le=5,
        description="Urgencia manual opcional (si no se envía, el LLM calculará la prioridad sugerida).",
    )


class IncidenteResponse(BaseModel):
    """Schema representing an incident report with AI analysis results."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: str
    descripcion: Optional[str] = None
    lat: float
    lng: float
    barrio: Optional[str] = None
    urgencia: int
    estado: str
    testimonio: Optional[str] = None
    analisis_ia: Optional[str] = None
    recursos_solicitados: list[RecursoSugerido] = []
    prioridad_sugerida: Optional[int] = None
    operador_id: Optional[uuid.UUID] = None
    origen_reporte: Optional[str] = "operador_campo"
    creado_en: Optional[datetime] = None
    actualizado_en: Optional[datetime] = None


class DespachoItem(BaseModel):
    """Schema for individual resource dispatch item."""

    punto_id: uuid.UUID
    insumo_nombre: str
    cantidad: int = Field(..., gt=0)


class IncidenteStatusUpdate(BaseModel):
    """Schema for updating the operational status of an incident."""

    estado: Literal["pendiente", "en_atencion", "resuelto"]
    despachos: Optional[list[DespachoItem]] = None


class IncidenteUpdate(BaseModel):
    """Schema for editing an incident's core fields."""

    testimonio: Optional[str] = Field(None, min_length=5)
    urgencia: Optional[int] = Field(None, ge=1, le=5)
    tipo: Optional[str] = None
    estado: Optional[Literal["pendiente", "en_atencion", "resuelto"]] = None
    despachos: Optional[list[DespachoItem]] = None
