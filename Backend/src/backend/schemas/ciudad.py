"""Pydantic schemas for the global city-state snapshot (estado_ciudad), contexto para agentes IA."""

from datetime import datetime
from typing import Optional
import uuid
from pydantic import BaseModel

from backend.schemas.alerta import AlertaNodoInactivo


class PuntosResumen(BaseModel):
    """Schema for the aggregate count of puntos_control by estado."""

    total: int
    activos: int
    saturados: int
    cerrados: int


class MisionUrgente(BaseModel):
    """Schema for one prioritized mission entry inside the city snapshot (misiones_priorizadas)."""

    origen_id: uuid.UUID
    destino_id: uuid.UUID
    insumo_id: uuid.UUID
    nombre_insumo: str
    urgencia: Optional[float] = None
    nivel_destino: str
    deficit: Optional[float] = None
    horas_faltando: float
    razon: str


class DeficitInsumo(BaseModel):
    """Schema for one insumo's citywide accumulated deficit."""

    insumo: str
    categoria: Optional[str] = None
    deficit_total: float


class EstadoCiudadResponse(BaseModel):
    """Schema for the full global city-state snapshot returned by estado_ciudad()."""

    timestamp: datetime
    puntos: PuntosResumen
    misiones_urgentes: list[MisionUrgente] = []
    nodos_inactivos: list[AlertaNodoInactivo] = []
    deficit_total: list[DeficitInsumo] = []
