"""SQLAlchemy models for Insumos and Inventario."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from backend.infrastructure.persistence.models.base import Base, UUIDPrimaryKeyMixin


class InsumoModel(Base, UUIDPrimaryKeyMixin):
    """SQLAlchemy model for catalog of insumos (relief items)."""

    __tablename__ = "insumos"

    nombre = Column(String, unique=True, nullable=False)
    categoria = Column(String, nullable=True)
    unidad = Column(String, nullable=True)
    criticidad = Column(Integer, nullable=True)

    # Relationships
    inventarios = relationship("InventarioModel", back_populates="insumo", cascade="all, delete-orphan")


class InventarioModel(Base):
    """SQLAlchemy model for inventory levels and quantitative stock in puntos_control."""

    __tablename__ = "inventario"

    punto_id = Column(UUID(as_uuid=True), ForeignKey("puntos_control.id", ondelete="CASCADE"), primary_key=True)
    insumo_id = Column(UUID(as_uuid=True), ForeignKey("insumos.id", ondelete="CASCADE"), primary_key=True)
    cantidad_actual = Column(Integer, nullable=True, default=0)
    cantidad_necesaria = Column(Integer, nullable=True, default=100)
    nivel = Column(String, nullable=False, default="bien")
    actualizado_en = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    actualizado_por = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Relationships
    punto = relationship("PuntoControlModel")
    insumo = relationship("InsumoModel", back_populates="inventarios")
    usuario_actualizador = relationship("UserModel")
