"""Pydantic schemas for insumo synonym resolution and quantitative resource registration."""

from typing import Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field


class ConsultaInsumoResponse(BaseModel):
    """Schema for a read-only insumo/synonym resolution lookup (resolver_insumo, sin escribir nada)."""

    insumo_canonico: Optional[str] = None
    insumo_id: Optional[uuid.UUID] = None
    era_sinonimo: bool = False


class RegistrarRecursoCreate(BaseModel):
    """Schema for registering a quantitative resource amount via free-text insumo name."""

    punto_id: uuid.UUID = Field(..., description="Punto de control donde se registra el recurso.")
    nombre_recurso: str = Field(..., min_length=1, description="Nombre libre del insumo (ej. 'agua potable').")
    cantidad_actual: int = Field(..., ge=0, description="Cantidad física disponible.")
    cantidad_necesaria: int = Field(..., ge=0, description="Cantidad requerida/objetivo.")


class InventarioActualizadoItem(BaseModel):
    """Schema for the resulting inventory row after registering a resource."""

    model_config = ConfigDict(from_attributes=True)

    insumo_id: uuid.UUID
    nombre: str
    nivel: str
    cantidad_actual: int
    cantidad_necesaria: int


class RegistrarRecursoResponse(BaseModel):
    """Schema for the result of registrar_con_normalizacion(), con el inventario resultante."""

    insumo_canonico: str
    era_sinonimo: bool
    sinonimo_original: str
    inventario_actualizado: InventarioActualizadoItem
