"""Endpoints for operational monitoring and inactivity alerts (RF-16, RF-17)."""

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
import json
import logging
from fastapi import APIRouter, status
from sqlalchemy import func, select, text

from backend.api.deps import DatabaseSession, RequirePublicEntity
from backend.domain.entities.user import UserRole
from backend.infrastructure.persistence.models.inventario import InventarioModel
from backend.infrastructure.persistence.models.punto_control import PuntoControlModel
from backend.schemas.alerta import AlertaNodoInactivo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alertas", tags=["Alertas Operativas & Monitoreo"])


@router.get(
    "/nodos-inactivos",
    response_model=list[AlertaNodoInactivo],
    summary="List Inactive Nodes (>3 Hours without reports)",
    description=(
        "Returns active control points that have not reported inventory updates in more than "
        "3 hours (RF-17). ENTE_PUBLICO only sees alerts for its own nodes; ADMIN_GUBERNAMENTAL "
        "sees all of them (same scoping as /puntos-control/mis-nodos)."
    ),
    status_code=status.HTTP_200_OK,
)
async def get_nodos_inactivos(
    current_user: RequirePublicEntity, db: DatabaseSession
) -> Sequence[AlertaNodoInactivo]:
    """Retrieve inactive nodes (>3 hours without inventory updates), scoped to the caller's ente."""
    is_admin = current_user.role == UserRole.ADMIN_GUBERNAMENTAL
    bind = db.get_bind()
    if bind and bind.dialect.name == "postgresql":
        try:
            result = await db.execute(
                text("SELECT alertas_nodos_inactivos(:user_id)"),
                {"user_id": None if is_admin else str(current_user.id)},
            )
            raw_json = result.scalar_one_or_none() or "[]"
            if isinstance(raw_json, str):
                data = json.loads(raw_json)
            else:
                data = raw_json
            return [AlertaNodoInactivo.model_validate(item) for item in data]
        except Exception:
            # Una sentencia fallida en Postgres deja la transacción en estado "aborted":
            # ninguna sentencia posterior corre hasta un ROLLBACK. Sin este rollback, el
            # fallback de abajo se ejecutaría sobre esa misma transacción rota y fallaría
            # también con InFailedSQLTransactionError, enmascarando el error real detrás
            # de un traceback que no dice nada sobre la causa original.
            logger.exception(
                "alertas_nodos_inactivos() falló en Postgres; usando fallback ORM."
            )
            await db.rollback()

    # Generic / SQLite fallback using ORM
    three_hours_ago = datetime.now(timezone.utc) - timedelta(hours=3)
    stmt = (
        select(
            PuntoControlModel.id,
            PuntoControlModel.nombre,
            PuntoControlModel.direccion,
            PuntoControlModel.responsable,
            func.coalesce(func.max(InventarioModel.actualizado_en), PuntoControlModel.actualizado_en, PuntoControlModel.creado_en).label("ultima_actualizacion"),
        )
        .outerjoin(InventarioModel, InventarioModel.punto_id == PuntoControlModel.id)
        .where(PuntoControlModel.estado == "activo")
        .group_by(
            PuntoControlModel.id,
            PuntoControlModel.nombre,
            PuntoControlModel.direccion,
            PuntoControlModel.responsable,
            PuntoControlModel.actualizado_en,
            PuntoControlModel.creado_en,
        )
        .having(
            func.coalesce(func.max(InventarioModel.actualizado_en), PuntoControlModel.actualizado_en, PuntoControlModel.creado_en) < three_hours_ago
        )
    )
    if not is_admin:
        stmt = stmt.where(PuntoControlModel.responsable_user_id == current_user.id)
    res = await db.execute(stmt)
    alertas: list[AlertaNodoInactivo] = []
    now = datetime.now(timezone.utc)
    for row in res.all():
        last_dt = row.ultima_actualizacion
        # SQLite (fallback de dev) devuelve datetimes naive aunque se guardaron en UTC;
        # normalizamos antes de restar para no explotar con offset-naive vs offset-aware.
        if last_dt and last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        hours = round((now - last_dt).total_seconds() / 3600, 1) if last_dt else 3.0
        alertas.append(
            AlertaNodoInactivo(
                id=row.id,
                nombre=row.nombre,
                direccion=row.direccion,
                responsable=row.responsable,
                ultima_actualizacion=last_dt,
                horas_sin_reporte=hours,
            )
        )
    return alertas
