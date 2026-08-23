#!/usr/bin/env python3
"""
clean_all.py

Elimina TODOS los datos operativos de la base de datos, dejando únicamente
el catálogo de insumos (tabla insumos — datos de configuración estática).

Tablas borradas:
  necesidades, nodos_afectados, red_logistica, inventario, puntos_control

Se conservan:
  users (usuarios demo), insumos (catálogo estático)

Después de correr esto siembra los 5 hospitales/bancos de sangre que existían
ANTES del terremoto, de modo que aparecen en el mapa antes de que el demo arranque.

Después de correr esto, ejecuta:
    uv run python scripts/live_demo.py

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

ENTE_EMAIL = "ente.alcaldia@sogr.gov.co"

# Hospitales y bancos de sangre que operaban ANTES del terremoto.
# Se reinsertan después de la limpieza para que estén visibles en el mapa
# desde el primer momento del demo.
HOSPITALES_PREEXISTENTES = [
    ("Banco de Sangre HUV",       "hospital", 3.430000, -76.542222,
     "Calle 5 # 36-08, Urgencias HUV",              "08:00–18:00"),
    ("Banco de Sangre Cruz Roja", "hospital", 3.428333, -76.543889,
     "Cra. 38 Bis # 5B, Parqueadero San Fernando",  "08:00–18:00"),
    ("Banco de Sangre Hemolife",  "hospital", 3.470000, -76.523611,
     "Calle 38N # 3N-61, Prados del Norte",         "08:00–18:00"),
    ("Fundación Valle del Lili",  "hospital", 3.373611, -76.530556,
     "Sede Principal, Torre 2, Piso 4",             "08:00–18:00"),
    ("Banco de Sangre Imbanaco",  "hospital", 3.427778, -76.544444,
     "Cra. 38 Bis # 5B2-04, Barrio Santa Isabel",  "08:00–18:00"),
]


def main() -> None:
    print("AVISO: esto borrará todos los datos operativos (puntos_control,")
    print("       incidentes, nodos_afectados, inventario).")
    print("       Se conservan usuarios e insumos.")
    print("       Luego siembra los 5 hospitales pre-existentes.")
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

        # Sembrar hospitales pre-existentes
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (ENTE_EMAIL,))
            row = cur.fetchone()
            if not row:
                print(f"  WARN: usuario ente '{ENTE_EMAIL}' no encontrado — "
                      "ejecuta seed_users.py primero. Hospitales no sembrados.")
            else:
                ente_id = row[0]
                sembrados = 0
                for nombre, tipo, lat, lng, dir_, horario in HOSPITALES_PREEXISTENTES:
                    cur.execute(
                        """
                        INSERT INTO puntos_control
                          (nombre, tipo, lat, lng, direccion, horario,
                           responsable_user_id, verificado, estado)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, true, 'activo')
                        ON CONFLICT DO NOTHING
                        """,
                        (nombre, tipo, lat, lng, dir_, horario, ente_id),
                    )
                    sembrados += cur.rowcount
                conn.commit()
                print(f"  {sembrados} hospitales/bancos de sangre pre-existentes sembrados.")

        print("\n   Siguiente paso: uv run python scripts/live_demo.py")
    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
