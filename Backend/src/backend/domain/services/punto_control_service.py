"""Domain Application Service for Punto de Control / Nodes management."""

from collections.abc import Sequence
import uuid

from backend.core.exceptions import BadRequestException, ConflictException, NotFoundException
from backend.domain.entities.punto_control import (
    EstadoPuntoControl,
    PuntoControlEntity,
    TipoPuntoControl,
)
from backend.domain.entities.user import UserRole
from backend.domain.ports.punto_control_repository import PuntoControlRepository
from backend.domain.ports.user_repository import UserRepository


class PuntoControlService:
    """Application service coordinating PuntoControl operations."""

    def __init__(
        self,
        punto_repo: PuntoControlRepository,
        user_repo: UserRepository,
    ) -> None:
        self.punto_repo = punto_repo
        self.user_repo = user_repo

    async def list_all(self) -> Sequence[PuntoControlEntity]:
        """List all control points."""
        return await self.punto_repo.list_all()

    async def get_by_id(self, punto_id: uuid.UUID | str) -> PuntoControlEntity:
        """Get control point by id."""
        if isinstance(punto_id, str):
            try:
                punto_id = uuid.UUID(punto_id)
            except ValueError:
                raise BadRequestException(f"Invalid UUID format: '{punto_id}'.")
        
        punto = await self.punto_repo.get_by_id(punto_id)
        if not punto:
            raise NotFoundException(f"Punto de control '{punto_id}' not found.")
        return punto

    async def create_punto_control(
        self,
        nombre: str,
        lat: float,
        lng: float,
        responsable_user_id: uuid.UUID | str,
        tipo: TipoPuntoControl | str = TipoPuntoControl.ACOPIO,
        estado: EstadoPuntoControl | str = EstadoPuntoControl.ACTIVO,
        direccion: str | None = None,
        horario: str | None = None,
        telefono: str | None = None,
        responsable: str | None = None,
        verificado: bool = True,
    ) -> PuntoControlEntity:
        """Create a new control point ensuring responsible user is an ENTE_PUBLICO."""
        # 1. Validate coordinates
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            raise BadRequestException(f"Invalid coordinates: lat={lat}, lng={lng}.")

        # 2. Check if name already exists
        existing = await self.punto_repo.get_by_nombre(nombre)
        if existing:
            raise ConflictException(f"Punto de control with name '{nombre}' already exists.")

        # 3. Validate responsable_user_id
        if isinstance(responsable_user_id, str):
            try:
                resp_uuid = uuid.UUID(responsable_user_id)
            except ValueError:
                raise BadRequestException(f"Invalid UUID for responsable_user_id: '{responsable_user_id}'.")
        else:
            resp_uuid = responsable_user_id

        user = await self.user_repo.get_by_id(resp_uuid)
        if not user:
            raise NotFoundException(f"Responsable user '{resp_uuid}' not found.")

        # User MUST be ENTE_PUBLICO (or ADMIN_GUBERNAMENTAL if public authority)
        if user.role != UserRole.ENTE_PUBLICO and user.role != UserRole.ADMIN_GUBERNAMENTAL:
            raise BadRequestException(
                f"El responsable del nodo debe pertenecer al rol '{UserRole.ENTE_PUBLICO.value}', "
                f"pero el usuario asignado tiene el rol '{user.role.value}'."
            )

        resp_nombre = responsable or user.email

        # 4. Instantiate entity
        punto = PuntoControlEntity.create_new(
            nombre=nombre,
            lat=lat,
            lng=lng,
            tipo=tipo,
            estado=estado,
            direccion=direccion,
            horario=horario,
            telefono=telefono,
            responsable=resp_nombre,
            responsable_user_id=user.id,
            verificado=verificado,
        )

        return await self.punto_repo.create(punto)
