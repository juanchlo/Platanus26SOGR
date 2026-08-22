"""Pydantic schemas for Insumos, Inventario, and Resource Requests."""

from datetime import datetime
from typing import Literal, Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field


class InsumoResponse(BaseModel):
    """Schema representing an insumo item from the catalog."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    categoria: Optional[str] = None
    unidad: Optional[str] = None
    criticidad: Optional[int] = None


class InventarioItemResponse(BaseModel):
    """Schema representing inventory stock level for a specific insumo at a punto."""

    insumo_id: uuid.UUID
    nombre: str
    categoria: Optional[str] = None
    unidad: Optional[str] = None
    criticidad: Optional[int] = None
    nivel: str = "bien"  # 'no_hay' | 'poco' | 'bien' | 'sobra'
    actualizado_en: Optional[datetime] = None
    actualizado_por: Optional[uuid.UUID] = None


class InventarioUpdateItem(BaseModel):
    """Schema for updating a single insumo level."""

    insumo_id: uuid.UUID
    nivel: Literal["no_hay", "poco", "bien", "sobra"]


class InventarioBulkUpdateRequest(BaseModel):
    """Schema for updating multiple inventory stock levels for a node."""

    items: list[InventarioUpdateItem]


class PeticionRecursoCreate(BaseModel):
    """Schema for an Ente Público creating an emergency resource request for a node."""

    tipo: str = Field(..., description="Tipo de recurso o necesidad solicitada (ej. 'Agua Potable', 'Alimentos').")
    descripcion: str = Field(..., min_length=5, description="Detalle del faltante o requerimiento logístico.")
    urgencia: int = Field(default=3, ge=1, le=5, description="Nivel de urgencia (1 a 5).")


class PeticionRecursoResponse(BaseModel):
    """Schema representing a created emergency resource request."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: str
    descripcion: Optional[str] = None
    lat: float
    lng: float
    barrio: Optional[str] = None
    urgencia: Optional[int] = 3
    estado: str = "pendiente"
    creado_en: Optional[datetime] = None
