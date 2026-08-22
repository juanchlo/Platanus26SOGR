"""Domain service for managing Insumos, Inventario, and Resource Requests."""

from datetime import datetime, timezone
from typing import Any
import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.exceptions import ForbiddenException, NotFoundException
from backend.domain.entities.user import UserRole
from backend.infrastructure.persistence.models.inventario import InsumoModel, InventarioModel
from backend.infrastructure.persistence.models.necesidad import NecesidadModel
from backend.infrastructure.persistence.models.punto_control import PuntoControlModel
from backend.schemas.inventario import (
    InsumoResponse,
    InventarioBulkUpdateRequest,
    InventarioItemResponse,
    PeticionRecursoCreate,
    PeticionRecursoResponse,
)


class InventarioService:
    """Service encapsulating business logic for inventory and emergency resource requests."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_insumos(self) -> list[InsumoResponse]:
        """Fetch full catalog of available relief items."""
        stmt = select(InsumoModel).order_by(InsumoModel.categoria.asc(), InsumoModel.nombre.asc())
        result = await self.session.execute(stmt)
        return [InsumoResponse.model_validate(i) for i in result.scalars().all()]

    async def get_inventario_by_punto(self, punto_id: uuid.UUID) -> list[InventarioItemResponse]:
        """Fetch all insumos with current inventory status for a specific control point."""
        # 1. Verify punto exists
        punto_stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto_id)
        punto_res = await self.session.execute(punto_stmt)
        punto = punto_res.scalar_one_or_none()
        if not punto:
            raise NotFoundException(f"Punto de control con ID {punto_id} no encontrado.")

        # 2. Get all insumos
        insumos_stmt = select(InsumoModel).order_by(InsumoModel.categoria.asc(), InsumoModel.nombre.asc())
        insumos = (await self.session.execute(insumos_stmt)).scalars().all()

        # 3. Get existing inventario rows
        inv_stmt = select(InventarioModel).where(InventarioModel.punto_id == punto_id)
        inv_map = {inv.insumo_id: inv for inv in (await self.session.execute(inv_stmt)).scalars().all()}

        # 4. Merge results
        items: list[InventarioItemResponse] = []
        for insumo in insumos:
            inv_row = inv_map.get(insumo.id)
            items.append(
                InventarioItemResponse(
                    insumo_id=insumo.id,
                    nombre=insumo.nombre,
                    categoria=insumo.categoria,
                    unidad=insumo.unidad,
                    criticidad=insumo.criticidad,
                    nivel=inv_row.nivel if inv_row else "bien",
                    actualizado_en=inv_row.actualizado_en if inv_row else punto.actualizado_en,
                    actualizado_por=inv_row.actualizado_por if inv_row else None,
                )
            )

        return items

    async def update_inventario(
        self,
        punto_id: uuid.UUID,
        payload: InventarioBulkUpdateRequest,
        current_user_id: uuid.UUID,
        current_user_role: str,
    ) -> list[InventarioItemResponse]:
        """Update inventory levels for a node.
        
        Strict permission rule: Only ADMIN_GUBERNAMENTAL or the assigned ENTE_PUBLICO responsable can update.
        """
        punto_stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto_id)
        punto = (await self.session.execute(punto_stmt)).scalar_one_or_none()
        if not punto:
            raise NotFoundException(f"Punto de control con ID {punto_id} no encontrado.")

        # RBAC check
        is_admin = current_user_role in [UserRole.ADMIN_GUBERNAMENTAL, UserRole.ADMIN_GUBERNAMENTAL.value, "admin_gubernamental"]
        is_assigned_responsible = punto.responsable_user_id == current_user_id

        if not (is_admin or is_assigned_responsible):
            raise ForbiddenException("No tienes autorización para actualizar el inventario de este nodo. Solo el Ente Público asignado o un Administrador pueden modificarlo.")

        now_utc = datetime.now(timezone.utc)

        # Upsert inventory rows
        for item in payload.items:
            existing_stmt = select(InventarioModel).where(
                InventarioModel.punto_id == punto_id,
                InventarioModel.insumo_id == item.insumo_id,
            )
            inv_row = (await self.session.execute(existing_stmt)).scalar_one_or_none()

            if inv_row:
                inv_row.nivel = item.nivel
                inv_row.actualizado_en = now_utc
                inv_row.actualizado_por = current_user_id
            else:
                new_inv = InventarioModel(
                    punto_id=punto_id,
                    insumo_id=item.insumo_id,
                    nivel=item.nivel,
                    actualizado_en=now_utc,
                    actualizado_por=current_user_id,
                )
                self.session.add(new_inv)

        # Touch punto.actualizado_en to reset inactivity timer
        punto.actualizado_en = now_utc
        await self.session.commit()

        return await self.get_inventario_by_punto(punto_id)

    async def create_peticion_recurso(
        self,
        punto_id: uuid.UUID,
        payload: PeticionRecursoCreate,
        current_user_id: uuid.UUID,
        current_user_role: str,
    ) -> PeticionRecursoResponse:
        """Create an urgent resource request from an Ente Público for their assigned node."""
        punto_stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto_id)
        punto = (await self.session.execute(punto_stmt)).scalar_one_or_none()
        if not punto:
            raise NotFoundException(f"Punto de control con ID {punto_id} no encontrado.")

        # RBAC check
        is_admin = current_user_role in [UserRole.ADMIN_GUBERNAMENTAL, UserRole.ADMIN_GUBERNAMENTAL.value, "admin_gubernamental"]
        is_assigned_responsible = punto.responsable_user_id == current_user_id

        if not (is_admin or is_assigned_responsible):
            raise ForbiddenException("No tienes autorización para emitir solicitudes de recursos para este nodo.")

        now_utc = datetime.now(timezone.utc)
        necesidad = NecesidadModel(
            tipo=payload.tipo,
            descripcion=f"[{punto.nombre}] {payload.descripcion}",
            lat=punto.lat,
            lng=punto.lng,
            barrio=punto.direccion or "Cali",
            urgencia=payload.urgencia,
            estado="pendiente",
            creado_en=now_utc,
            actualizado_en=now_utc,
        )
        self.session.add(necesidad)
        punto.actualizado_en = now_utc
        await self.session.commit()
        await self.session.refresh(necesidad)

        return PeticionRecursoResponse.model_validate(necesidad)
