"""Pydantic schemas for PuntoControl / Nodes."""

from datetime import datetime
from typing import Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field

from backend.domain.entities.punto_control import EstadoPuntoControl, TipoPuntoControl


class PuntoControlCreate(BaseModel):
    """Payload schema for creating a new Punto de Control node."""

    nombre: str = Field(
        ...,
        min_length=3,
        max_length=150,
        description="Nombre único del punto de control o nodo logístico.",
        examples=["Centro de Acopio Estadio Pascual Guerrero"],
    )
    tipo: TipoPuntoControl = Field(
        default=TipoPuntoControl.ACOPIO,
        description="Tipo de nodo de emergencia: acopio, albergue, hospital o comando.",
        examples=["acopio"],
    )
    estado: EstadoPuntoControl = Field(
        default=EstadoPuntoControl.ACTIVO,
        description="Estado operativo del nodo: activo, saturado, cerrado o pendiente.",
        examples=["activo"],
    )
    lat: float = Field(
        ...,
        ge=-90.0,
        le=90.0,
        description="Latitud geográfica en grados decimales (Cali: aprox 3.3 a 3.5).",
        examples=[3.4296],
    )
    lng: float = Field(
        ...,
        ge=-180.0,
        le=180.0,
        description="Longitud geográfica en grados decimales (Cali: aprox -76.55 a -76.50).",
        examples=[-76.5414],
    )
    responsable_user_id: uuid.UUID = Field(
        ...,
        description="UUID del usuario con rol ENTE_PUBLICO asignado como responsable del nodo.",
        examples=["a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"],
    )
    direccion: Optional[str] = Field(
        default=None,
        description="Dirección física del nodo en Cali.",
        examples=["Cra. 34 # 5B-10"],
    )
    horario: Optional[str] = Field(
        default=None,
        description="Horario de atención u operación del nodo.",
        examples=["24 Horas"],
    )
    telefono: Optional[str] = Field(
        default=None,
        description="Teléfono de contacto para coordinación logística.",
        examples=["+57 (2) 555-1234"],
    )
    responsable: Optional[str] = Field(
        default=None,
        description="Nombre institucional o de la entidad pública responsable (ej. Cruz Roja, Alcaldía).",
        examples=["Secretaría de Gestión del Riesgo"],
    )
    verificado: bool = Field(
        default=True,
        description="Indicador de verificación oficial por parte de la administración.",
    )


class PuntoControlResponse(BaseModel):
    """Schema representing a retrieved Punto de Control node."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    tipo: Optional[str] = None
    estado: Optional[str] = None
    lat: float
    lng: float
    direccion: Optional[str] = None
    horario: Optional[str] = None
    telefono: Optional[str] = None
    responsable: Optional[str] = None
    responsable_user_id: Optional[uuid.UUID] = None
    verificado: bool = False
    creado_en: Optional[datetime] = None
    actualizado_en: Optional[datetime] = None
