"""Seed demo users for RBAC testing and system operation."""

import asyncio
from pathlib import Path
import sys

# Add src to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir / "src"))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

from backend.domain.entities.user import UserRole
from backend.infrastructure.database import async_session_maker, init_db
from backend.infrastructure.persistence.repositories.user_repository import SQLAlchemyUserRepository
from backend.infrastructure.security import password_hasher
from backend.domain.services.auth_service import AuthService

DEMO_USERS = [
    {
        "email": "admin@sogr.gov.co",
        "password": "admin123",
        "role": UserRole.ADMIN_GUBERNAMENTAL,
    },
    {
        "email": "ente.alcaldia@sogr.gov.co",
        "password": "ente123",
        "role": UserRole.ENTE_PUBLICO,
    },
    {
        "email": "ente.cruzroja@sogr.gov.co",
        "password": "ente123",
        "role": UserRole.ENTE_PUBLICO,
    },
    {
        "email": "operador@sogr.gov.co",
        "password": "operador123",
        "role": UserRole.OPERADOR_CAMPO,
    },
    {
        "email": "civil@sogr.gov.co",
        "password": "civil123",
        "role": UserRole.CIVIL,
    },
]

async def seed_users():
    await init_db()
    async with async_session_maker() as session:
        user_repo = SQLAlchemyUserRepository(session)
        auth_service = AuthService(user_repo=user_repo, password_hasher=password_hasher)

        print("=== Sembrando usuarios demo en la base de datos ===")
        for user_data in DEMO_USERS:
            existing = await auth_service.get_by_email(user_data["email"])
            if not existing:
                created = await auth_service.register_user(
                    email=user_data["email"],
                    plain_password=user_data["password"],
                    role=user_data["role"],
                )
                print(f"✓ Creado: {created.email} ({created.role.value}) [ID: {created.id}]")
            else:
                # Update password hash in case it was created with old hash
                existing.hashed_password = password_hasher.hash_password(user_data["password"])
                existing.role = user_data["role"]
                existing.is_active = True
                await user_repo.update(existing)
                print(f"✓ Actualizado: {existing.email} ({existing.role.value}) [ID: {existing.id}]")
        
        await session.commit()
        print("🎉 Usuarios sembrados correctamente.")

if __name__ == "__main__":
    asyncio.run(seed_users())
