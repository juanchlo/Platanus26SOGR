#!/usr/bin/env python3
"""
seed_simulacion.py

Polling sobre necesidades cada POLL_INTERVAL segundos. Al detectar el primer
INSERT real, inyecta los datos de simulacion SOGR llamando a la API como si
fueran usuarios reales — los flujos de LLM y Voronoi corren normalmente:

  Admin    → 5 puntos_control + inventario
  Operador → 10 incidentes con testimonio  → LLM analiza cada uno
  Ente     → 10 nodos_afectados            → Voronoi asigna + plan_respuesta

Idempotente: si ya existen necesidades con testimonio '[SIM]...', omite.

Uso:
    cd Backend && uv run python scripts/seed_simulacion.py
"""

import os
import sys
import time
from pathlib import Path

import httpx
import psycopg2
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuracion
# ---------------------------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env.dev")

_raw_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
DSN = _raw_url.replace("postgresql+asyncpg://", "postgresql://")

API_BASE = "http://localhost:8000/api/v1"
POLL_INTERVAL = 3  # segundos

CREDS = {
    "admin":    {"email": "admin@sogr.gov.co",         "password": "admin123"},
    "ente":     {"email": "ente.alcaldia@sogr.gov.co", "password": "ente123"},
    "operador": {"email": "operador@sogr.gov.co",       "password": "operador123"},
}

# ---------------------------------------------------------------------------
# Datos de simulacion — puntos_control
# ---------------------------------------------------------------------------

PUNTOS_CONTROL = [
    {"nombre": "Centro Acopio Las Americas",  "tipo": "acopio",   "lat": 3.4440, "lng": -76.5210},
    {"nombre": "Albergue Comunal Siloe",       "tipo": "albergue", "lat": 3.4250, "lng": -76.5580},
    {"nombre": "Puesto de Salud San Fernando", "tipo": "hospital", "lat": 3.4296, "lng": -76.5414},
    {"nombre": "PMU Centro",                   "tipo": "comando",  "lat": 3.4516, "lng": -76.5320},
    {"nombre": "Centro Acopio Aguablanca",     "tipo": "acopio",   "lat": 3.4180, "lng": -76.5050},
]

# (nombre_punto, nombre_insumo, cantidad_actual, cantidad_necesaria)
# nivel se calcula solo via trigger calcular_nivel_inventario
INVENTARIO = [
    ("Centro Acopio Las Americas",  "agua",                     200,  50),   # sobra
    ("Centro Acopio Las Americas",  "alimentos no perecederos",  80, 100),   # bien
    ("Centro Acopio Las Americas",  "colchonetas",               70,  80),   # bien
    ("Centro Acopio Las Americas",  "kits de aseo",               0,  60),   # no_hay
    ("Albergue Comunal Siloe",      "cobijas",                   60,  80),   # bien
    ("Albergue Comunal Siloe",      "ropa",                      40,  60),   # bien
    ("Albergue Comunal Siloe",      "kits de aseo",               5,  40),   # poco
    ("Albergue Comunal Siloe",      "agua",                       0,  80),   # no_hay
    ("Puesto de Salud San Fernando","medicamentos basicos",       90,  50),   # sobra
    ("Puesto de Salud San Fernando","suero oral",                 70,  30),   # sobra
    ("Puesto de Salud San Fernando","agua",                       10,  60),   # poco
    ("PMU Centro",                  "agua",                       50,  80),   # bien
    ("PMU Centro",                  "comida preparada",           10,  60),   # poco
    ("Centro Acopio Aguablanca",    "alimentos no perecederos",  120,  80),   # sobra
    ("Centro Acopio Aguablanca",    "agua",                       60,  80),   # bien
    ("Centro Acopio Aguablanca",    "panales",                     0,  40),   # no_hay
]

# ---------------------------------------------------------------------------
# Datos de simulacion — incidentes (operador de campo)
#
# Prefijo [SIM] en testimonio → idempotencia + el LLM igual procesa el resto
# ---------------------------------------------------------------------------

INCIDENTES = [
    {
        "testimonio":     "[SIM] 80 familias sin agua, 3 heridos leves, ladera inestable",
        "lat": 3.4250, "lng": -76.5550, "barrio": "Siloe", "urgencia_manual": 5,
    },
    {
        "testimonio":     "[SIM] Derrumbe en ladera, 2 familias atrapadas sin comunicacion",
        "lat": 3.4600, "lng": -76.5550, "barrio": "Terron Colorado", "urgencia_manual": 4,
    },
    {
        "testimonio":     "[SIM] Inundacion severa, sin electricidad, hay ninos y adultos mayores",
        "lat": 3.4180, "lng": -76.5020, "barrio": "Aguablanca", "urgencia_manual": 5,
    },
    {
        "testimonio":     "[SIM] Sin agua ni alimentos, 40 familias reportan necesidades urgentes",
        "lat": 3.4200, "lng": -76.5060, "barrio": "El Diamante", "urgencia_manual": 4,
    },
    {
        "testimonio":     "[SIM] Viviendas danadas, familias sin techo requieren albergue temporal",
        "lat": 3.4160, "lng": -76.5040, "barrio": "El Vallado", "urgencia_manual": 3,
    },
    {
        "testimonio":     "[SIM] Heridos por colapso estructural, requieren traslado medico urgente",
        "lat": 3.4580, "lng": -76.4970, "barrio": "Alfonso Lopez", "urgencia_manual": 5,
    },
    {
        "testimonio":     "[SIM] Deslizamiento bloqueo el acceso, familias completamente aisladas",
        "lat": 3.3712, "lng": -76.5450, "barrio": "Melendez", "urgencia_manual": 4,
    },
    {
        "testimonio":     "[SIM] Escasez critica de medicamentos, adultos mayores en riesgo",
        "lat": 3.4270, "lng": -76.5560, "barrio": "Siloe", "urgencia_manual": 3,
    },
    {
        "testimonio":     "[SIM] Sin gas ni agua, 25 familias llevan 2 dias sin servicios basicos",
        "lat": 3.4300, "lng": -76.5400, "barrio": "San Pascual", "urgencia_manual": 4,
    },
    {
        "testimonio":     "[SIM] Danos menores en estructuras, requieren evaluacion tecnica urgente",
        "lat": 3.4520, "lng": -76.5300, "barrio": "El Penon", "urgencia_manual": 2,
    },
]

# ---------------------------------------------------------------------------
# Datos de simulacion — nodos_afectados (ente publico)
# ---------------------------------------------------------------------------

NODOS_AFECTADOS = [
    {
        "titulo":             "SOGR-SIM · Siloe · A",
        "descripcion":        "80 familias sin agua, ladera inestable con 3 heridos leves",
        "necesidad":          "agua potable, atencion medica, estabilizacion de ladera",
        "lat": 3.4250, "lng": -76.5550, "severidad": 5, "personas_afectadas": 320,
    },
    {
        "titulo":             "SOGR-SIM · Terron Colorado · B",
        "descripcion":        "Derrumbe en ladera con 2 familias atrapadas",
        "necesidad":          "rescate, equipo de remocion de escombros",
        "lat": 3.4600, "lng": -76.5550, "severidad": 4, "personas_afectadas": 8,
    },
    {
        "titulo":             "SOGR-SIM · Aguablanca · C",
        "descripcion":        "Inundacion severa sin electricidad, presencia de ninos y adultos mayores",
        "necesidad":          "albergue temporal, agua potable, alimentos",
        "lat": 3.4180, "lng": -76.5020, "severidad": 5, "personas_afectadas": 200,
    },
    {
        "titulo":             "SOGR-SIM · El Diamante · D",
        "descripcion":        "Sin agua ni alimentos, 40 familias en situacion critica",
        "necesidad":          "agua potable, alimentos no perecederos",
        "lat": 3.4200, "lng": -76.5060, "severidad": 4, "personas_afectadas": 160,
    },
    {
        "titulo":             "SOGR-SIM · El Vallado · E",
        "descripcion":        "Viviendas danadas, familias requieren albergue temporal",
        "necesidad":          "albergue, colchonetas, cobijas",
        "lat": 3.4160, "lng": -76.5040, "severidad": 3, "personas_afectadas": 80,
    },
    {
        "titulo":             "SOGR-SIM · Alfonso Lopez · F",
        "descripcion":        "Heridos por colapso estructural requieren traslado medico inmediato",
        "necesidad":          "atencion medica urgente, medicamentos, traslado",
        "lat": 3.4580, "lng": -76.4970, "severidad": 5, "personas_afectadas": 30,
    },
    {
        "titulo":             "SOGR-SIM · Melendez · G",
        "descripcion":        "Deslizamiento bloqueo el acceso, familias aisladas sin suministros",
        "necesidad":          "apertura de via, suministros basicos",
        "lat": 3.3712, "lng": -76.5450, "severidad": 4, "personas_afectadas": 50,
    },
    {
        "titulo":             "SOGR-SIM · Siloe · H",
        "descripcion":        "Escasez de medicamentos criticos para adultos mayores",
        "necesidad":          "medicamentos basicos, suero oral",
        "lat": 3.4270, "lng": -76.5560, "severidad": 3, "personas_afectadas": 40,
    },
    {
        "titulo":             "SOGR-SIM · San Pascual · I",
        "descripcion":        "Sin gas ni agua, 25 familias",
        "necesidad":          "agua potable, alimentos preparados",
        "lat": 3.4300, "lng": -76.5400, "severidad": 4, "personas_afectadas": 100,
    },
    {
        "titulo":             "SOGR-SIM · El Penon · J",
        "descripcion":        "Danos menores en estructuras, evaluacion requerida",
        "necesidad":          "evaluacion tecnica de estructura",
        "lat": 3.4520, "lng": -76.5300, "severidad": 2, "personas_afectadas": 15,
    },
]

# ---------------------------------------------------------------------------
# Helpers de API
# ---------------------------------------------------------------------------


def login(client: httpx.Client, role: str) -> dict:
    r = client.post(f"{API_BASE}/auth/login", json=CREDS[role])
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def get_ente_id(client: httpx.Client, admin_h: dict) -> str:
    r = client.get(f"{API_BASE}/users", headers=admin_h)
    r.raise_for_status()
    for u in r.json():
        if u["email"] == CREDS["ente"]["email"]:
            return u["id"]
    raise RuntimeError(f"Usuario ente '{CREDS['ente']['email']}' no encontrado — corre seed_users.py primero")


def get_insumos(client: httpx.Client) -> dict:
    """Devuelve {nombre: uuid}"""
    r = client.get(f"{API_BASE}/insumos")
    r.raise_for_status()
    return {i["nombre"]: i["id"] for i in r.json()}


def get_puntos_existentes(client: httpx.Client) -> dict:
    """Devuelve {nombre: uuid}"""
    r = client.get(f"{API_BASE}/puntos-control")
    r.raise_for_status()
    return {p["nombre"]: p["id"] for p in r.json()}

# ---------------------------------------------------------------------------
# Inyeccion
# ---------------------------------------------------------------------------


def ya_inyectado(cur) -> bool:
    cur.execute("SELECT COUNT(*) FROM necesidades WHERE testimonio LIKE '[SIM]%'")
    return cur.fetchone()[0] > 0


def inyectar(db_conn) -> None:
    with db_conn.cursor() as cur:
        if ya_inyectado(cur):
            print("  i  Datos de simulacion ya existen — omitiendo.")
            return

    with httpx.Client(timeout=30.0) as client:

        # ── 1. Admin: puntos_control ──────────────────────────────────────
        print("  -> [Admin] Obteniendo contexto...")
        admin_h = login(client, "admin")
        ente_id = get_ente_id(client, admin_h)
        insumos = get_insumos(client)
        existentes = get_puntos_existentes(client)

        print("  -> [Admin] Creando puntos_control...")
        punto_ids = dict(existentes)  # incluye los ya existentes
        creados = 0
        for p in PUNTOS_CONTROL:
            if p["nombre"] in existentes:
                continue
            payload = {**p, "responsable_user_id": ente_id, "verificado": True}
            r = client.post(f"{API_BASE}/puntos-control", json=payload, headers=admin_h)
            if r.status_code in (200, 201):
                punto_ids[p["nombre"]] = r.json()["id"]
                creados += 1
            else:
                print(f"     WARN {p['nombre']}: {r.status_code} {r.text[:100]}")
        print(f"     {creados} creados, {len(existentes)} ya existian")

        # ── 2. Admin: inventario ──────────────────────────────────────────
        print("  -> [Admin] Cargando inventario...")
        ok_inv = 0
        for punto_nombre, insumo_nombre, cant_actual, cant_necesaria in INVENTARIO:
            pid = punto_ids.get(punto_nombre)
            iid = insumos.get(insumo_nombre)
            if not pid or not iid:
                print(f"     WARN: skip {punto_nombre}/{insumo_nombre} (no encontrado)")
                continue
            payload = {"items": [{"insumo_id": iid, "cantidad_actual": cant_actual, "cantidad_necesaria": cant_necesaria}]}
            r = client.put(f"{API_BASE}/puntos-control/{pid}/inventario", json=payload, headers=admin_h)
            if r.status_code in (200, 201):
                ok_inv += 1
            else:
                print(f"     WARN inventario {insumo_nombre}: {r.status_code} {r.text[:100]}")
        print(f"     {ok_inv}/{len(INVENTARIO)} items cargados")

        # ── 3. Operador: incidentes → LLM ────────────────────────────────
        print("  -> [Operador] Creando incidentes (LLM analizando cada uno)...")
        op_h = login(client, "operador")
        ok_inc = 0
        for inc in INCIDENTES:
            r = client.post(f"{API_BASE}/incidentes", json=inc, headers=op_h, timeout=60.0)
            if r.status_code in (200, 201):
                ok_inc += 1
                data = r.json()
                print(f"     OK {inc['barrio']:20} urgencia={data.get('urgencia')}  tipo={data.get('tipo', '')[:30]}")
            else:
                print(f"     WARN {inc['barrio']}: {r.status_code} {r.text[:100]}")
        print(f"     {ok_inc}/{len(INCIDENTES)} incidentes creados")

        # ── 4. Ente: nodos_afectados → Voronoi ───────────────────────────
        print("  -> [Ente] Creando nodos_afectados (Voronoi + plan_respuesta)...")
        ente_h = login(client, "ente")
        ok_na = 0
        for na in NODOS_AFECTADOS:
            r = client.post(f"{API_BASE}/nodos-afectados", json=na, headers=ente_h, timeout=30.0)
            if r.status_code in (200, 201):
                ok_na += 1
                data = r.json()
                plan = (data.get("plan_respuesta") or "sin plan aun")[:70]
                print(f"     OK {na['titulo']:35} → {plan}")
            else:
                print(f"     WARN {na['titulo']}: {r.status_code} {r.text[:100]}")
        print(f"     {ok_na}/{len(NODOS_AFECTADOS)} nodos_afectados creados")

    print("\n  OK Simulacion completa.")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def contar_necesidades(cur) -> int:
    cur.execute("SELECT COUNT(*) FROM necesidades")
    return cur.fetchone()[0]


def main() -> None:
    host_info = DSN.split("@")[-1] if "@" in DSN else DSN
    print(f"Conectando a {host_info} ...")

    conn = psycopg2.connect(DSN)
    conn.autocommit = True

    with conn.cursor() as cur:
        conteo_anterior = contar_necesidades(cur)

    print(f"OK necesidades actuales: {conteo_anterior}")
    print(f"OK Polling cada {POLL_INTERVAL}s. Crea un incidente en la app para disparar la inyeccion.")
    print("   (Ctrl+C para salir)\n")

    try:
        while True:
            time.sleep(POLL_INTERVAL)

            with conn.cursor() as cur:
                conteo_actual = contar_necesidades(cur)

            if conteo_actual > conteo_anterior:
                print(f"\nDetectado nuevo incidente ({conteo_anterior} -> {conteo_actual})")
                conteo_anterior = conteo_actual

                conn.autocommit = False
                try:
                    inyectar(conn)
                    conn.commit()
                except Exception as exc:
                    conn.rollback()
                    print(f"  ERROR: {exc}", file=sys.stderr)
                finally:
                    conn.autocommit = True

    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
