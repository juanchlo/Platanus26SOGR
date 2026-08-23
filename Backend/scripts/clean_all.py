#!/usr/bin/env python3
"""
clean_all.py

Elimina TODOS los datos operativos de la base de datos, dejando únicamente
el catálogo de insumos (tabla insumos — datos de configuración estática).

Tablas borradas:
  necesidades, nodos_afectados, red_logistica, inventario, puntos_control

Se conservan:
  users (usuarios demo), insumos (catálogo estático)

Después de correr esto, ejecuta:
    uv run python scripts/live_demo.py   (o seed_simulacion.py)

Uso:
    cd Backend
    set -a && source .env.dev && set +a
    uv run python scripts/clean_all.py
"""

import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env.dev")

_raw = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
DSN = _raw.replace("postgresql+asyncpg://", "postgresql://")


def main() -> None:
    print("AVISO: esto borrará todos los datos operativos (puntos_control,")
    print("       incidentes, nodos_afectados, inventario).")
    print("       Se conservan usuarios e insumos.")
    respuesta = input("\n¿Continuar? [s/N] ").strip().lower()
    if respuesta != "s":
        print("Cancelado.")
        return

    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM necesidades")
            print(f"  necesidades eliminadas:     {cur.rowcount}")

            cur.execute("DELETE FROM nodos_afectados")
            print(f"  nodos_afectados eliminados: {cur.rowcount}")

            cur.execute("DELETE FROM red_logistica")
            print(f"  red_logistica eliminada:    {cur.rowcount}")

            cur.execute("DELETE FROM inventario")
            print(f"  inventario eliminado:       {cur.rowcount}")

            cur.execute("DELETE FROM puntos_control")
            print(f"  puntos_control eliminados:  {cur.rowcount}")

        conn.commit()
        print("\nOK Base de datos limpia.")
        print("   Siguiente paso: uv run python scripts/live_demo.py")
    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
