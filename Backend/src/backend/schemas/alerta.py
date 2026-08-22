"""Pydantic schemas for Operational Alerts (RF-16, RF-17)."""

from datetime import datetime
from typing import Optional
import uuid
from pydantic import BaseModel, ConfigDict


class AlertaNodoInactivo(BaseModel):
    """Schema representing an inactive node alert (>3h without inventory update)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    direccion: Optional[str] = None
    responsable: Optional[str] = None
    ultima_actualizacion: Optional[datetime] = None
    horas_sin_reporte: float
