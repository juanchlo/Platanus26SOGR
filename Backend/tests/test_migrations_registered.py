"""Guarda que Backend/scripts/apply_supabase_migrations.py aplique TODOS los .sql de
Backend/supabase/, para no repetir el hallazgo R-01 de docs/PLAN_MASTER_OPTIMIZACION.md:
dos migraciones (sinonimos_insumos.sql, catalogo_insumos_ia.sql) existian en disco pero
nunca se ejecutaban, asi que resolver_insumo()/registrar_con_normalizacion() no existian
en la base de datos y los endpoints de /recursos fallaban en silencio.
"""

from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR / "scripts"))

from apply_supabase_migrations import SQL_FILES_ORDER  # noqa: E402


def test_all_supabase_sql_files_are_registered() -> None:
    """Todo archivo .sql en Backend/supabase/ debe estar en SQL_FILES_ORDER."""
    supabase_dir = BACKEND_DIR / "supabase"
    on_disk = {p.name for p in supabase_dir.glob("*.sql")}
    registered = set(SQL_FILES_ORDER)

    missing = on_disk - registered
    assert not missing, (
        f"Los siguientes archivos .sql existen en Backend/supabase/ pero no estan "
        f"registrados en SQL_FILES_ORDER (nunca se aplicarian): {sorted(missing)}"
    )


def test_no_registered_migration_is_a_ghost_file() -> None:
    """Todo archivo en SQL_FILES_ORDER debe existir realmente en Backend/supabase/."""
    supabase_dir = BACKEND_DIR / "supabase"
    on_disk = {p.name for p in supabase_dir.glob("*.sql")}
    registered = set(SQL_FILES_ORDER)

    ghosts = registered - on_disk
    assert not ghosts, (
        f"SQL_FILES_ORDER referencia archivos que no existen en Backend/supabase/: "
        f"{sorted(ghosts)}"
    )
