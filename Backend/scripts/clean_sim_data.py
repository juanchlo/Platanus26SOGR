#!/usr/bin/env python3
"""
Elimina los datos inyectados por seed_simulacion.py, dejando únicamente
lo que insertan seed.sql y seed_users.py:
  - 6 puntos_control del seed
  - insumos del catálogo (intactos)
  - inventario de esos 6 puntos
  - usuarios demo
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

SEED_PUNTOS = [
    "Plazoleta Jairo Varela",
    "Banco de Alimentos de Cali",
    "Cruz Roja Seccional Valle",
    "DEMO — Albergue Comuna 13",
    "DEMO — Albergue Comuna 18",
    "DEMO — Albergue Comuna 20",
]

def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            # 1. Borrar todas las necesidades (incidentes de operador)
            cur.execute("DELETE FROM necesidades")
            print(f"  necesidades eliminadas:     {cur.rowcount}")

            # 2. Borrar todos los nodos_afectados
            cur.execute("DELETE FROM nodos_afectados")
            print(f"  nodos_afectados eliminados: {cur.rowcount}")

            # 3. Borrar red_logistica e inventario de puntos que no son del seed
            cur.execute(
                "DELETE FROM red_logistica WHERE origen_id IN "
                "(SELECT id FROM puntos_control WHERE nombre != ALL(%s)) "
                "OR destino_id IN "
                "(SELECT id FROM puntos_control WHERE nombre != ALL(%s))",
                (SEED_PUNTOS, SEED_PUNTOS),
            )
            print(f"  red_logistica extra elim.:  {cur.rowcount}")

            cur.execute(
                "DELETE FROM inventario WHERE punto_id IN "
                "(SELECT id FROM puntos_control WHERE nombre != ALL(%s))",
                (SEED_PUNTOS,),
            )
            print(f"  inventario extra eliminado: {cur.rowcount}")

            # 4. Borrar puntos_control que no son del seed
            cur.execute(
                "DELETE FROM puntos_control WHERE nombre != ALL(%s)",
                (SEED_PUNTOS,),
            )
            print(f"  puntos_control extra elim.: {cur.rowcount}")

        conn.commit()
        print("\n✓ Base de datos limpia — solo quedan los datos del seed.")
    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
