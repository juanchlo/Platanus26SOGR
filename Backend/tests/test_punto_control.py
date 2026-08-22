"""Unit tests for PuntoControl SQLAlchemy model and domain entity."""

import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.domain.entities.punto_control import (
    EstadoPuntoControl,
    PuntoControlEntity,
    TipoPuntoControl,
)
from backend.domain.entities.user import UserEntity, UserRole
from backend.infrastructure.persistence.models.punto_control import PuntoControlModel
from backend.infrastructure.persistence.models.user import UserModel


@pytest.mark.asyncio
async def test_punto_control_model_crud_with_responsable(db_session: AsyncSession) -> None:
    # 1. Create a user
    user_entity = UserEntity.create_new(
        email="coordinador@emergencias.gob",
        hashed_password="hashed_pass_123",
        role=UserRole.OPERADOR_CAMPO,
    )
    user_model = UserModel.from_entity(user_entity)
    db_session.add(user_model)
    await db_session.flush()

    # 2. Create a punto_control with responsable_user_id referencing users.id
    punto_entity = PuntoControlEntity.create_new(
        nombre="Centro de Acopio Central",
        lat=-33.4489,
        lng=-70.6693,
        tipo=TipoPuntoControl.ACOPIO,
        estado=EstadoPuntoControl.ACTIVO,
        direccion="Av. Libertador Bernardo O'Higgins 123",
        horario="08:00 - 20:00",
        telefono="+56912345678",
        responsable="Capitan Gomez",
        responsable_user_id=user_model.id,
        verificado=True,
    )
    punto_model = PuntoControlModel.from_entity(punto_entity)
    db_session.add(punto_model)
    await db_session.flush()

    # 3. Retrieve and verify
    stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto_entity.id)
    result = await db_session.execute(stmt)
    retrieved = result.scalar_one()

    assert retrieved.nombre == "Centro de Acopio Central"
    assert retrieved.responsable_user_id == user_model.id
    assert retrieved.responsable == "Capitan Gomez"
    assert retrieved.verificado is True

    # 4. Check entity mapper
    mapped_entity = retrieved.to_entity()
    assert mapped_entity.id == punto_entity.id
    assert mapped_entity.responsable_user_id == user_model.id
    assert mapped_entity.tipo == TipoPuntoControl.ACOPIO


@pytest.mark.asyncio
async def test_punto_control_nullable_responsable_user_id(db_session: AsyncSession) -> None:
    # Test that responsable_user_id is nullable
    punto_entity = PuntoControlEntity.create_new(
        nombre="Albergue Municipal",
        lat=-33.4500,
        lng=-70.6700,
        tipo=TipoPuntoControl.ALBERGUE,
        responsable_user_id=None,
    )
    punto_model = PuntoControlModel.from_entity(punto_entity)
    db_session.add(punto_model)
    await db_session.flush()

    stmt = select(PuntoControlModel).where(PuntoControlModel.id == punto_entity.id)
    result = await db_session.execute(stmt)
    retrieved = result.scalar_one()

    assert retrieved.responsable_user_id is None
