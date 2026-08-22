"""SQLAlchemy model for Nodos Afectados (reportes de emergencia geolocalizados)."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from backend.infrastructure.persistence.models.base import Base, UUIDPrimaryKeyMixin


class NodoAfectadoModel(Base, UUIDPrimaryKeyMixin):
    """SQLAlchemy model for geolocated affected-area emergency reports."""

    __tablename__ = "nodos_afectados"

    titulo = Column(String, nullable=False)
    descripcion = Column(Text, nullable=False)
    necesidad = Column(Text, nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    severidad = Column(Integer, nullable=True, default=3)
    personas_afectadas = Column(Integer, nullable=True, default=0)
    estado = Column(String, nullable=False, default="activo")
    barrio = Column(String, nullable=True)
    creado_por = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    creado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    actualizado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    creador = relationship("UserModel")
