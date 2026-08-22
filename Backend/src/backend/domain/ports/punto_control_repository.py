"""Abstract port interface for PuntoControl persistence operations."""

from abc import ABC, abstractmethod
import uuid

from backend.domain.entities.punto_control import PuntoControlEntity


class PuntoControlRepository(ABC):
    """Abstract port defining storage and retrieval contract for PuntoControl entities."""

    @abstractmethod
    async def get_by_id(self, punto_id: uuid.UUID) -> PuntoControlEntity | None:
        """Retrieve a PuntoControl by unique ID."""
        raise NotImplementedError

    @abstractmethod
    async def get_by_nombre(self, nombre: str) -> PuntoControlEntity | None:
        """Retrieve a PuntoControl by unique name."""
        raise NotImplementedError

    @abstractmethod
    async def list_all(self) -> list[PuntoControlEntity]:
        """Retrieve all control points."""
        raise NotImplementedError

    @abstractmethod
    async def create(self, punto: PuntoControlEntity) -> PuntoControlEntity:
        """Persist a new PuntoControl entity."""
        raise NotImplementedError

    @abstractmethod
    async def update(self, punto: PuntoControlEntity) -> PuntoControlEntity:
        """Update an existing PuntoControl entity."""
        raise NotImplementedError
