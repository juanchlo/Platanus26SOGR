"""SQLAlchemy ORM model for PuntoControl with entity mappers."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
import uuid

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.domain.entities.punto_control import (
    EstadoPuntoControl,
    PuntoControlEntity,
    TipoPuntoControl,
)
from backend.infrastructure.persistence.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from backend.infrastructure.persistence.models.user import UserModel


class PuntoControlModel(Base, UUIDPrimaryKeyMixin):
    """Database ORM mapping for the 'puntos_control' table."""

    __tablename__ = "puntos_control"

    nombre: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )
    tipo: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
    )
    estado: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
        default="activo",
    )
    lat: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )
    lng: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )
    direccion: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
    )
    horario: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
    )
    telefono: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
    )
    responsable: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
    )
    responsable_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    verificado: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    creado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    actualizado_en: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    responsable_user: Mapped[Optional["UserModel"]] = relationship(
        "UserModel",
        foreign_keys=[responsable_user_id],
        lazy="joined",
    )

    def to_entity(self) -> PuntoControlEntity:
        """Map ORM database model to pure domain PuntoControlEntity."""
        return PuntoControlEntity(
            id=self.id,
            nombre=self.nombre,
            tipo=TipoPuntoControl(self.tipo) if self.tipo else None,
            estado=EstadoPuntoControl(self.estado) if self.estado else None,
            lat=self.lat,
            lng=self.lng,
            direccion=self.direccion,
            horario=self.horario,
            telefono=self.telefono,
            responsable=self.responsable,
            responsable_user_id=self.responsable_user_id,
            verificado=self.verificado,
            creado_en=self.creado_en,
            actualizado_en=self.actualizado_en,
        )

    @classmethod
    def from_entity(cls, entity: PuntoControlEntity) -> "PuntoControlModel":
        """Instantiate ORM model from a pure domain PuntoControlEntity."""
        tipo_str = entity.tipo.value if isinstance(entity.tipo, TipoPuntoControl) else entity.tipo
        estado_str = (
            entity.estado.value
            if isinstance(entity.estado, EstadoPuntoControl)
            else entity.estado
        )
        return cls(
            id=entity.id,
            nombre=entity.nombre,
            tipo=tipo_str,
            estado=estado_str,
            lat=entity.lat,
            lng=entity.lng,
            direccion=entity.direccion,
            horario=entity.horario,
            telefono=entity.telefono,
            responsable=entity.responsable,
            responsable_user_id=entity.responsable_user_id,
            verificado=entity.verificado,
            creado_en=entity.creado_en or datetime.now(timezone.utc),
            actualizado_en=entity.actualizado_en or datetime.now(timezone.utc),
        )
