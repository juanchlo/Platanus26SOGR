"""SQLAlchemy repository implementation of the PuntoControlRepository domain port."""

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.entities.punto_control import PuntoControlEntity
from backend.domain.ports.punto_control_repository import PuntoControlRepository
from backend.infrastructure.persistence.models.punto_control import PuntoControlModel


class SQLAlchemyPuntoControlRepository(PuntoControlRepository):
    """Outbound adapter implementing persistence for PuntoControl entities with SQLAlchemy."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_id(self, punto_id: uuid.UUID) -> PuntoControlEntity | None:
        """Fetch punto by UUID from database and map to domain entity."""
        stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto_id)
        result = await self.session.execute(stmt)
        punto_orm = result.scalar_one_or_none()
        return punto_orm.to_entity() if punto_orm else None

    async def get_by_nombre(self, nombre: str) -> PuntoControlEntity | None:
        """Fetch punto by name from database and map to domain entity."""
        stmt = select(PuntoControlModel).where(PuntoControlModel.nombre == nombre.strip())
        result = await self.session.execute(stmt)
        punto_orm = result.scalar_one_or_none()
        return punto_orm.to_entity() if punto_orm else None

    async def list_all(self) -> list[PuntoControlEntity]:
        """Fetch all control points ordered by creation."""
        stmt = select(PuntoControlModel).order_by(PuntoControlModel.creado_en.asc())
        result = await self.session.execute(stmt)
        return [p.to_entity() for p in result.scalars().all()]

    async def create(self, punto: PuntoControlEntity) -> PuntoControlEntity:
        """Persist a new PuntoControl record in database."""
        punto_orm = PuntoControlModel.from_entity(punto)
        self.session.add(punto_orm)
        await self.session.flush()
        await self.session.refresh(punto_orm)
        return punto_orm.to_entity()

    async def update(self, punto: PuntoControlEntity) -> PuntoControlEntity:
        """Update an existing PuntoControl record in database."""
        stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto.id)
        result = await self.session.execute(stmt)
        punto_orm = result.scalar_one()

        punto_orm.nombre = punto.nombre
        punto_orm.tipo = punto.tipo.value if hasattr(punto.tipo, "value") else punto.tipo
        punto_orm.estado = punto.estado.value if hasattr(punto.estado, "value") else punto.estado
        punto_orm.lat = punto.lat
        punto_orm.lng = punto.lng
        punto_orm.direccion = punto.direccion
        punto_orm.horario = punto.horario
        punto_orm.telefono = punto.telefono
        punto_orm.responsable = punto.responsable
        punto_orm.responsable_user_id = punto.responsable_user_id
        punto_orm.verificado = punto.verificado

        await self.session.flush()
        await self.session.refresh(punto_orm)
        return punto_orm.to_entity()
