"""SQLAlchemy model for Necesidades (civil / node emergency requests)."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, Integer, String

from backend.infrastructure.persistence.models.base import Base, UUIDPrimaryKeyMixin


class NecesidadModel(Base, UUIDPrimaryKeyMixin):
    """SQLAlchemy model for urgent resource requests and needs."""

    __tablename__ = "necesidades"

    tipo = Column(String, nullable=False)
    descripcion = Column(String, nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    barrio = Column(String, nullable=True)
    urgencia = Column(Integer, nullable=True, default=3)
    estado = Column(String, nullable=False, default="pendiente")
    creado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    actualizado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
