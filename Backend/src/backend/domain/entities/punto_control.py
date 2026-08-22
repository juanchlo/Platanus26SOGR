"""Domain entities for Punto de Control."""

from dataclasses import dataclass
from datetime import datetime, timezone
import enum
import uuid


class TipoPuntoControl(str, enum.Enum):
    """Types of control points."""

    ACOPIO = "acopio"
    ALBERGUE = "albergue"
    HOSPITAL = "hospital"
    COMANDO = "comando"


class EstadoPuntoControl(str, enum.Enum):
    """States of control points."""

    ACTIVO = "activo"
    SATURADO = "saturado"
    CERRADO = "cerrado"
    PENDIENTE = "pendiente"


@dataclass
class PuntoControlEntity:
    """Core domain entity representing a Punto de Control."""

    id: uuid.UUID
    nombre: str
    lat: float
    lng: float
    tipo: TipoPuntoControl | str | None = None
    estado: EstadoPuntoControl | str | None = EstadoPuntoControl.ACTIVO
    direccion: str | None = None
    horario: str | None = None
    telefono: str | None = None
    responsable: str | None = None
    responsable_user_id: uuid.UUID | None = None
    verificado: bool = False
    creado_en: datetime | None = None
    actualizado_en: datetime | None = None

    @classmethod
    def create_new(
        cls,
        nombre: str,
        lat: float,
        lng: float,
        tipo: TipoPuntoControl | str | None = None,
        estado: EstadoPuntoControl | str | None = EstadoPuntoControl.ACTIVO,
        direccion: str | None = None,
        horario: str | None = None,
        telefono: str | None = None,
        responsable: str | None = None,
        responsable_user_id: uuid.UUID | None = None,
        verificado: bool = False,
    ) -> "PuntoControlEntity":
        """Factory method to instantiate a new domain PuntoControl entity."""
        now = datetime.now(timezone.utc)
        return cls(
            id=uuid.uuid4(),
            nombre=nombre.strip(),
            lat=lat,
            lng=lng,
            tipo=tipo,
            estado=estado,
            direccion=direccion,
            horario=horario,
            telefono=telefono,
            responsable=responsable,
            responsable_user_id=responsable_user_id,
            verificado=verificado,
            creado_en=now,
            actualizado_en=now,
        )
