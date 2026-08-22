"""Script to apply database initialization and Supabase SQL files in required order.

Order of execution:
1. init_db() (Creates public.users and declarative models via SQLAlchemy)
2. schema.sql
3. postgis.sql
4. pgrouting.sql
5. realtime.sql
6. comunas.sql (trigger de geocodificación debe existir antes de sembrar necesidades)
7. seed.sql
8. rediseño_inventario.sql (necesita filas reales de inventario del seed para el backfill)
9. rls.sql (al final: depende de que todas las tablas ya existan)
10. inicializar_red_logistica()
"""

import asyncio
from pathlib import Path
import sys

from sqlalchemy import text

# Add src to path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir / "src"))

try:
    from dotenv import load_dotenv
    # Load .env explicitly from the Backend directory so it doesn't depend on CWD
    load_dotenv(backend_dir / ".env")
except ImportError:
    pass

from backend.infrastructure.database import engine, inicializar_red_logistica, init_db


SQL_FILES_ORDER = [
    "schema.sql",
    "postgis.sql",
    "pgrouting.sql",
    "realtime.sql",
    "comunas.sql",
    "seed.sql",
    "rediseño_inventario.sql",
    "rls.sql",
]


async def run_migrations() -> None:
    print("=== 1. Ejecutando init_db() (creación de public.users y modelos) ===")
    await init_db()
    print("✓ init_db() completado con éxito.\n")

    if engine.dialect.name != "postgresql":
        print("✗ ERROR: Estas migraciones de Supabase (PostGIS, pgRouting, etc.) requieren PostgreSQL.")
        print(f"  El dialecto actual es: '{engine.dialect.name}'.")
        print("  Por favor configura DATABASE_URL en tu archivo .env con las credenciales de Supabase:")
        print("  DATABASE_URL=postgresql+asyncpg://postgres.tu-ref:password@.../postgres")
        print("  Saliendo sin aplicar los scripts SQL.\n")
        return

    supabase_dir = backend_dir / "supabase"

    print("=== 2. Aplicando scripts SQL en Supabase en orden estricto ===")
    async with engine.begin() as conn:
        # Get raw asyncpg connection to bypass prepared statement limitation for multiple commands
        raw_conn = await conn.get_raw_connection()
        asyncpg_conn = raw_conn.driver_connection

        for sql_file in SQL_FILES_ORDER:
            file_path = supabase_dir / sql_file
            if not file_path.exists():
                print(f"✗ Archivo no encontrado: {file_path}")
                continue

            print(f"→ Aplicando {sql_file}...")
            content = file_path.read_text(encoding="utf-8")

            # Execute directly via asyncpg to allow multiple statements (;-separated)
            await asyncpg_conn.execute(content)

            print(f"✓ {sql_file} aplicado correctamente.")

    print("\n=== 3. Ejecutando inicializar_red_logistica() ===")
    resultado = await inicializar_red_logistica()
    print(f"✓ Red logística inicializada: {resultado}\n")
    print("🎉 Migración y configuración completadas exitosamente.")


if __name__ == "__main__":
    asyncio.run(run_migrations())
