"""SQLAlchemy model for Necesidades (incidentes, testimonios de campo y requerimientos de emergencia)."""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from backend.infrastructure.persistence.models.base import Base, UUIDPrimaryKeyMixin


class NecesidadModel(Base, UUIDPrimaryKeyMixin):
    """SQLAlchemy model for incident reports, operator testimonies and emergency needs."""

    __tablename__ = "necesidades"

    tipo = Column(String, nullable=False, default="Emergencia / Incidente")
    descripcion = Column(String, nullable=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    barrio = Column(String, nullable=True)
    urgencia = Column(Integer, nullable=True, default=3)
    estado = Column(String, nullable=False, default="pendiente")
    testimonio = Column(Text, nullable=True)
    analisis_ia = Column(Text, nullable=True)
    recursos_solicitados = Column(Text, nullable=True)
    prioridad_sugerida = Column(Integer, nullable=True)
    operador_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    origen_reporte = Column(String, nullable=True, default="operador_campo")
    creado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    actualizado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    operador = relationship("UserModel")
