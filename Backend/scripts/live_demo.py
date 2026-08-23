#!/usr/bin/env python3
"""
live_demo.py

Simulación temporizada con datos reales del terremoto de Cali del 10 de agosto
de 2026 (M7.4, epicentro San José del Palmar, Chocó).

Igual que seed_simulacion.py, espera el primer incidente real antes de inyectar.
Los datos se inyectan en 8 fases con pausas configurables, reproduciendo la
línea de tiempo real del desastre a escala comprimida.

  Fase 1 · Ago 10 07:34 AM — Ciudadela Petronio + 4 albergues + 3 transitorios
  Fase 2 · Ago 10 07:45 AM — 5 hospitales/bancos de sangre + incidente HUV
  Fase 3 · Ago 11        — Rescate activo zona sur
  Fase 4 · Ago 12-13     — Cierre de puntos transitorios (vía SQL directo)
  Fase 5 · Ago 18        — Recuperación USAR en HUV
  Fase 6 · Ago 19        — Riesgo gas industrial + apertura EMCALI
  Fase 7 · Ago 20        — Réplica sísmica
  Fase 8 · Ago 21        — Normalización: MIO reanuda operación

Idempotente: testimonios con prefijo '[DEMO]' indican que ya fue inyectado.

Uso:
    cd Backend
    set -a && source .env.dev && set +a
    uv run python scripts/live_demo.py
"""

import os
import sys
import time
from pathlib import Path

import httpx
import psycopg2
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env.dev")

_raw_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
DSN = _raw_url.replace("postgresql+asyncpg://", "postgresql://")

API_BASE = "http://localhost:8000/api/v1"
POLL_INTERVAL = 3    # segundos entre polls de la DB

PHASE_DELAY = 12     # segundos entre fases (cada "día" del desastre)
ITEM_DELAY  = 3      # segundos entre ítems dentro de la misma fase

CREDS = {
    "admin":    {"email": "admin@sogr.gov.co",         "password": "admin123"},
    "ente":     {"email": "ente.alcaldia@sogr.gov.co", "password": "ente123"},
    "operador": {"email": "operador@sogr.gov.co",       "password": "operador123"},
}

# Transitorios abiertos el 10/08 y cerrados el 13/08 (no hay PATCH en la API)
NOMBRES_TRANSITORIOS = [
    "Plazoleta Jairo Varela",
    "Escuela Nacional del Deporte",
    "Parque de la Caña",
]

# ---------------------------------------------------------------------------
# Fase 1 — Ago 10 · 07:34 AM «Hora Cero»
# Centro único oficial + 4 albergues + 3 transitorios + inventario
# ---------------------------------------------------------------------------

PUNTOS_FASE1 = [
    {
        "nombre": "Ciudadela Petronio Álvarez",
        "tipo": "acopio",
        "lat": 3.414167, "lng": -76.551944,
        "direccion": "Cra. 56 con Calle 3, C.D. Alberto Galindo",
        "horario": "08:00–12:00 / 14:00–18:00",
    },
    {
        "nombre": "Cancha de Hockey Miguel Calero",
        "tipo": "albergue",
        "lat": 3.425000, "lng": -76.538889,
        "direccion": "Calle 9 # 37-00, Unidad Deportiva",
        "horario": "24 Horas",
    },
    {
        "nombre": "Diamante de Béisbol",
        "tipo": "albergue",
        "lat": 3.422778, "lng": -76.534722,
        "direccion": "Unidad Deportiva Jaime Aparicio",
        "horario": "24 Horas",
    },
    {
        "nombre": "Coliseo Metropolitano del Norte",
        "tipo": "albergue",
        "lat": 3.479167, "lng": -76.502778,
        "direccion": "Cancha cubierta Sector Chiminangos",
        "horario": "24 Horas",
    },
    {
        "nombre": "CIDES Parque Los Pinos",
        "tipo": "albergue",
        "lat": 3.377778, "lng": -76.554167,
        "direccion": "Comuna 18",
        "horario": "24 Horas",
    },
    # Transitorios: activos ahora, se cierran en fase 4
    {
        "nombre": "Plazoleta Jairo Varela",
        "tipo": "acopio",
        "lat": 3.455822, "lng": -76.531044,
        "direccion": "Av. 2 Norte # 10 Norte-1, Barrio Granada",
        "horario": "Transitorio",
    },
    {
        "nombre": "Escuela Nacional del Deporte",
        "tipo": "acopio",
        "lat": 3.426353, "lng": -76.537144,
        "direccion": "Calle 9 # 34-01, Sector Eucarístico",
        "horario": "Transitorio",
    },
    {
        "nombre": "Parque de la Caña",
        "tipo": "acopio",
        "lat": 3.454167, "lng": -76.508889,
        "direccion": "Carrera 8 # 39-01",
        "horario": "Transitorio",
    },
]

INVENTARIO_FASE1 = [
    # Ciudadela Petronio Álvarez — centro oficial, 363 t de ayuda humanitaria
    ("Ciudadela Petronio Álvarez", "alimentos no perecederos", 500, 400),
    ("Ciudadela Petronio Álvarez", "agua",                    2000, 1000),
    ("Ciudadela Petronio Álvarez", "colchonetas",              300,  500),
    ("Ciudadela Petronio Álvarez", "kits de aseo",             150,  400),
    ("Ciudadela Petronio Álvarez", "ropa",                     800,  600),
    # Cancha de Hockey Miguel Calero
    ("Cancha de Hockey Miguel Calero", "cobijas",      200, 300),
    ("Cancha de Hockey Miguel Calero", "agua",          50, 200),
    ("Cancha de Hockey Miguel Calero", "kits de aseo", 20, 100),
    ("Cancha de Hockey Miguel Calero", "colchonetas",  100, 150),
    # Diamante de Béisbol
    ("Diamante de Béisbol", "cobijas",      180, 300),
    ("Diamante de Béisbol", "agua",          40, 200),
    ("Diamante de Béisbol", "kits de aseo", 15,  80),
    ("Diamante de Béisbol", "colchonetas",   80, 120),
    # Coliseo Metropolitano del Norte
    ("Coliseo Metropolitano del Norte", "cobijas",      250, 350),
    ("Coliseo Metropolitano del Norte", "agua",          30, 180),
    ("Coliseo Metropolitano del Norte", "kits de aseo", 10,  90),
    ("Coliseo Metropolitano del Norte", "colchonetas",  120, 160),
    # CIDES Parque Los Pinos
    ("CIDES Parque Los Pinos", "cobijas",      160, 250),
    ("CIDES Parque Los Pinos", "agua",          25, 150),
    ("CIDES Parque Los Pinos", "kits de aseo",  8,  70),
    ("CIDES Parque Los Pinos", "colchonetas",   60, 100),
]

INC_FASE1 = [
    {
        "testimonio":    "[DEMO] Colapso estructural masivo Torres del Limonar en Comuna 19, decenas de personas atrapadas bajo escombros, urgente rescate",
        "lat": 3.404167, "lng": -76.538889, "barrio": "Limonar", "urgencia_manual": 5,
    },
]

NODOS_FASE1 = [
    {
        "titulo":      "DEMO · Limonar · Torres del Limonar Colapsadas",
        "descripcion": "Colapso total de edificio residencial Torres del Limonar en la Calle 5, múltiples víctimas bajo escombros en Comuna 19",
        "necesidad":   "rescate inmediato, remoción de escombros, atención médica urgente, ambulancias, equipos hidráulicos",
        "lat": 3.404167, "lng": -76.538889, "severidad": 5, "personas_afectadas": 400,
    },
]

# ---------------------------------------------------------------------------
# Fase 2 — Ago 10 · 07:45 AM «Respuesta médica»
# 5 hospitales y bancos de sangre + inventario médico + incidente HUV
# ---------------------------------------------------------------------------

PUNTOS_FASE2 = [
    {
        "nombre": "Banco de Sangre HUV",
        "tipo": "hospital",
        "lat": 3.430000, "lng": -76.542222,
        "direccion": "Calle 5 # 36-08, Urgencias Hospital Universitario del Valle",
        "horario": "08:00–18:00",
    },
    {
        "nombre": "Banco de Sangre Cruz Roja",
        "tipo": "hospital",
        "lat": 3.428333, "lng": -76.543889,
        "direccion": "Cra. 38 Bis # 5B, Parqueadero San Fernando",
        "horario": "08:00–18:00",
    },
    {
        "nombre": "Banco de Sangre Hemolife",
        "tipo": "hospital",
        "lat": 3.470000, "lng": -76.523611,
        "direccion": "Calle 38N # 3N-61, Prados del Norte",
        "horario": "08:00–18:00",
    },
    {
        "nombre": "Fundación Valle del Lili",
        "tipo": "hospital",
        "lat": 3.373611, "lng": -76.530556,
        "direccion": "Sede Principal, Torre 2, Piso 4",
        "horario": "08:00–18:00",
    },
    {
        "nombre": "Banco de Sangre Imbanaco",
        "tipo": "hospital",
        "lat": 3.427778, "lng": -76.544444,
        "direccion": "Cra. 38 Bis # 5B2-04, Barrio Santa Isabel",
        "horario": "08:00–18:00",
    },
]

INVENTARIO_FASE2 = [
    ("Banco de Sangre HUV",       "medicamentos basicos", 100, 50),
    ("Banco de Sangre HUV",       "suero oral",            80, 30),
    ("Banco de Sangre HUV",       "agua",                  20, 80),
    ("Banco de Sangre Cruz Roja", "medicamentos basicos",  90, 50),
    ("Banco de Sangre Cruz Roja", "suero oral",            60, 30),
    ("Banco de Sangre Cruz Roja", "agua",                  15, 60),
]

INC_FASE2 = [
    {
        "testimonio":    "[DEMO] Hospital Universitario del Valle evacuado preventivamente por fisuras estructurales, pacientes en zonas abiertas del parqueadero, requieren traslado urgente",
        "lat": 3.430000, "lng": -76.542222, "barrio": "San Fernando", "urgencia_manual": 4,
    },
]

NODOS_FASE2 = [
    {
        "titulo":      "DEMO · HUV · Evacuación de Emergencia",
        "descripcion": "Hospital Universitario del Valle con fisuras estructurales graves, evacuado preventivamente, más de 1.650 heridos en las primeras horas",
        "necesidad":   "traslado de pacientes críticos, área médica alternativa, equipos portátiles de soporte vital",
        "lat": 3.430000, "lng": -76.542222, "severidad": 4, "personas_afectadas": 120,
    },
]

# ---------------------------------------------------------------------------
# Fase 3 — Ago 11 «Operación rescate USAR»
# ---------------------------------------------------------------------------

INC_FASE3 = [
    {
        "testimonio":    "[DEMO] Rescate activo zona sur de Cali, varios heridos entre escombros de viviendas, bomberos especializados USAR de Bogotá en operación con vida",
        "lat": 3.386111, "lng": -76.545833, "barrio": "Prados del Sur", "urgencia_manual": 4,
    },
]

NODOS_FASE3 = [
    {
        "titulo":      "DEMO · Zona Sur · Operación Rescate USAR",
        "descripcion": "Rescate de heridos entre escombros en zona sur de Cali, equipos especializados USAR de Bogotá lograron rescates con vida",
        "necesidad":   "equipos USAR, ambulancias, atención médica inmediata, comida y agua para rescatistas",
        "lat": 3.386111, "lng": -76.545833, "severidad": 4, "personas_afectadas": 60,
    },
]

# ---------------------------------------------------------------------------
# Fase 5 — Ago 18 «Recuperación USAR en HUV»
# ---------------------------------------------------------------------------

INC_FASE5 = [
    {
        "testimonio":    "[DEMO] Recuperación de cuerpos en perímetro del HUV por equipos USAR, área acordonada, operación forense activa desde las 08:00",
        "lat": 3.430100, "lng": -76.542300, "barrio": "San Fernando", "urgencia_manual": 3,
    },
]

NODOS_FASE5 = [
    {
        "titulo":      "DEMO · HUV · Recuperación USAR Día 8",
        "descripcion": "Labores de recuperación forense en el perímetro del Hospital Universitario del Valle, fase final de la operación de búsqueda",
        "necesidad":   "equipo forense, coordinación con familias damnificadas, apoyo psicosocial",
        "lat": 3.430100, "lng": -76.542300, "severidad": 3, "personas_afectadas": 20,
    },
]

# ---------------------------------------------------------------------------
# Fase 6 — Ago 19 «Gas industrial + apertura EMCALI»
# ---------------------------------------------------------------------------

PUNTOS_FASE6 = [
    {
        "nombre": "Lote EMCALI – La Base",
        "tipo": "comando",
        "lat": 3.465278, "lng": -76.494444,
        "direccion": "Carrera 8a con Calle 59",
        "horario": "06:00–23:59",
    },
]

INC_FASE6 = [
    {
        "testimonio":    "[DEMO] Retiro de 13 cilindros de gas industrial inestables en barrio Los Cámbulos, riesgo de deflagración en zona ya debilitada por el sismo, evacuación preventiva activa",
        "lat": 3.418056, "lng": -76.537500, "barrio": "Los Cámbulos", "urgencia_manual": 3,
    },
]

NODOS_FASE6 = [
    {
        "titulo":      "DEMO · Los Cámbulos · Riesgo Gas Industrial",
        "descripcion": "13 cilindros de gas industrial inestables detectados en zona residencial con daños sísmicos severos, evacuación activa del sector",
        "necesidad":   "evacuación preventiva del sector, equipo técnico de gas, control del perímetro, ventilación",
        "lat": 3.418056, "lng": -76.537500, "severidad": 3, "personas_afectadas": 200,
    },
]

# ---------------------------------------------------------------------------
# Fase 7 — Ago 20 · 20:38 PM «Réplica sísmica»
# ---------------------------------------------------------------------------

INC_FASE7 = [
    {
        "testimonio":    "[DEMO] Réplica sísmica percibida fuertemente en Cali a las 20:38, epicentro en Sipí Chocó, pánico en albergues, evaluación de nuevos daños estructurales en curso",
        "lat": 3.445000, "lng": -76.530000, "barrio": "Centro", "urgencia_manual": 2,
    },
]

NODOS_FASE7 = [
    {
        "titulo":      "DEMO · Cali · Réplica Sísmica Ago 20",
        "descripcion": "Réplica percibida fuertemente en la ciudad a las 20:38 PM con epicentro en Sipí, Chocó, pánico generalizado en albergues temporales",
        "necesidad":   "inspección estructural urgente en albergues, atención psicosocial, tranquilización de damnificados",
        "lat": 3.445000, "lng": -76.530000, "severidad": 2, "personas_afectadas": 500,
    },
]

# ---------------------------------------------------------------------------
# Fase 8 — Ago 21 «Normalización: MIO reanuda operación»
# ---------------------------------------------------------------------------

INC_FASE8 = [
    {
        "testimonio":    "[DEMO] Finalización remoción Edificio Vanessa en corredor Calle 5, vía completamente despejada, sistema MIO reanuda operación normal desde las 16:00",
        "lat": 3.426389, "lng": -76.543056, "barrio": "Calle 5", "urgencia_manual": 1,
    },
]

NODOS_FASE8 = [
    {
        "titulo":      "DEMO · Calle 5 · Remoción Finalizada y MIO",
        "descripcion": "Corredor de la Calle 5 despejado tras remoción del Edificio Vanessa, transporte masivo MIO reanuda operaciones normales",
        "necesidad":   "señalización vial de emergencia, coordinación con MIO, normalización del tráfico urbano",
        "lat": 3.426389, "lng": -76.543056, "severidad": 1, "personas_afectadas": 5000,
    },
]

# ---------------------------------------------------------------------------
# Definición de fases
# ---------------------------------------------------------------------------

FASES = [
    {
        "num": 1,
        "label": "Ago 10 · 07:34 AM — Hora Cero · Apertura de centros de apoyo",
        "puntos": PUNTOS_FASE1,
        "inv":    INVENTARIO_FASE1,
        "inc":    INC_FASE1,
        "nodos":  NODOS_FASE1,
    },
    {
        "num": 2,
        "label": "Ago 10 · 07:45 AM — Respuesta médica · Bancos de sangre activos",
        "puntos": PUNTOS_FASE2,
        "inv":    INVENTARIO_FASE2,
        "inc":    INC_FASE2,
        "nodos":  NODOS_FASE2,
    },
    {
        "num": 3,
        "label": "Ago 11 — Operación rescate USAR · Zona sur",
        "puntos": [],
        "inv":    [],
        "inc":    INC_FASE3,
        "nodos":  NODOS_FASE3,
    },
    {
        "num": 4,
        "label": "Ago 12-13 — Cierre de puntos transitorios",
        "puntos": [],
        "inv":    [],
        "inc":    [],
        "nodos":  [],
        "cerrar_transitorios": True,
    },
    {
        "num": 5,
        "label": "Ago 18 — Recuperación USAR en perímetro HUV",
        "puntos": [],
        "inv":    [],
        "inc":    INC_FASE5,
        "nodos":  NODOS_FASE5,
    },
    {
        "num": 6,
        "label": "Ago 19 — Riesgo gas industrial · Apertura lote EMCALI",
        "puntos": PUNTOS_FASE6,
        "inv":    [],
        "inc":    INC_FASE6,
        "nodos":  NODOS_FASE6,
    },
    {
        "num": 7,
        "label": "Ago 20 · 20:38 PM — Réplica sísmica desde Sipí",
        "puntos": [],
        "inv":    [],
        "inc":    INC_FASE7,
        "nodos":  NODOS_FASE7,
    },
    {
        "num": 8,
        "label": "Ago 21 — Normalización: MIO reanuda operación",
        "puntos": [],
        "inv":    [],
        "inc":    INC_FASE8,
        "nodos":  NODOS_FASE8,
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
    raise RuntimeError(
        f"Usuario ente '{CREDS['ente']['email']}' no encontrado — corre seed_users.py primero"
    )


def get_insumos(client: httpx.Client) -> dict:
    r = client.get(f"{API_BASE}/insumos")
    r.raise_for_status()
    return {i["nombre"]: i["id"] for i in r.json()}


def get_puntos_existentes(client: httpx.Client) -> dict:
    r = client.get(f"{API_BASE}/puntos-control")
    r.raise_for_status()
    return {p["nombre"]: p["id"] for p in r.json()}


# ---------------------------------------------------------------------------
# Inyección por fases
# ---------------------------------------------------------------------------


def ya_inyectado(cur) -> bool:
    cur.execute("SELECT COUNT(*) FROM necesidades WHERE testimonio LIKE '[DEMO]%'")
    return cur.fetchone()[0] > 0


def _cerrar_transitorios(db_conn) -> None:
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE puntos_control SET estado = 'cerrado' WHERE nombre = ANY(%s)",
            (NOMBRES_TRANSITORIOS,),
        )
    print(f"     {len(NOMBRES_TRANSITORIOS)} puntos transitorios marcados como 'cerrado'")


def _crear_puntos(client, admin_h, ente_id, punto_ids, puntos) -> None:
    existentes = set(punto_ids.keys())
    for p in puntos:
        if p["nombre"] in existentes:
            print(f"     skip (ya existe)  {p['nombre']}")
            continue
        payload = {**p, "responsable_user_id": ente_id, "verificado": True}
        r = client.post(f"{API_BASE}/puntos-control", json=payload, headers=admin_h)
        if r.status_code in (200, 201):
            punto_ids[p["nombre"]] = r.json()["id"]
            print(f"     OK  punto  {p['nombre']}  [{p['tipo']}]")
        else:
            print(f"     WARN {p['nombre']}: {r.status_code} {r.text[:80]}")
        time.sleep(ITEM_DELAY)


def _cargar_inventario(client, admin_h, punto_ids, insumos, inventario) -> None:
    ok = 0
    for punto_nombre, insumo_nombre, cant_actual, cant_necesaria in inventario:
        pid = punto_ids.get(punto_nombre)
        iid = insumos.get(insumo_nombre)
        if not pid or not iid:
            print(f"     WARN: skip inv {punto_nombre}/{insumo_nombre} (no encontrado)")
            continue
        payload = {
            "items": [
                {
                    "insumo_id": iid,
                    "cantidad_actual": cant_actual,
                    "cantidad_necesaria": cant_necesaria,
                }
            ]
        }
        r = client.put(
            f"{API_BASE}/puntos-control/{pid}/inventario", json=payload, headers=admin_h
        )
        if r.status_code in (200, 201):
            ok += 1
        else:
            print(f"     WARN inv {insumo_nombre}: {r.status_code} {r.text[:60]}")
    if ok:
        print(f"     {ok}/{len(inventario)} items de inventario cargados")


def _crear_incidentes(client, op_h, incidentes) -> None:
    for inc in incidentes:
        r = client.post(
            f"{API_BASE}/incidentes", json=inc, headers=op_h, timeout=90.0
        )
        if r.status_code in (200, 201):
            data = r.json()
            print(
                f"     OK  incidente  {inc['barrio']:20}  urgencia={data.get('urgencia')}  "
                f"tipo={str(data.get('tipo', ''))[:25]}"
            )
        else:
            print(f"     WARN incidente {inc['barrio']}: {r.status_code} {r.text[:80]}")
        time.sleep(ITEM_DELAY)


def _crear_nodos(client, ente_h, nodos) -> None:
    for na in nodos:
        r = client.post(
            f"{API_BASE}/nodos-afectados", json=na, headers=ente_h, timeout=30.0
        )
        if r.status_code in (200, 201):
            data = r.json()
            plan = (data.get("plan_respuesta") or "sin plan aún")[:60]
            print(f"     OK  nodo   {na['titulo']:40} → {plan}")
        else:
            print(f"     WARN nodo {na['titulo']}: {r.status_code} {r.text[:80]}")
        time.sleep(ITEM_DELAY)


def inyectar(db_conn) -> None:
    with db_conn.cursor() as cur:
        if ya_inyectado(cur):
            print("  i  Datos demo ya existen — omitiendo.")
            return

    with httpx.Client(timeout=30.0) as client:
        print("  -> Autenticando...")
        admin_h = login(client, "admin")
        ente_h  = login(client, "ente")
        op_h    = login(client, "operador")
        ente_id = get_ente_id(client, admin_h)
        insumos = get_insumos(client)
        punto_ids = dict(get_puntos_existentes(client))

        for fase in FASES:
            n     = fase["num"]
            total = len(FASES)
            print(f"\n  [{n}/{total}] {fase['label']}")

            if fase.get("cerrar_transitorios"):
                _cerrar_transitorios(db_conn)
            else:
                if fase["puntos"]:
                    _crear_puntos(client, admin_h, ente_id, punto_ids, fase["puntos"])
                if fase["inv"]:
                    _cargar_inventario(client, admin_h, punto_ids, insumos, fase["inv"])
                if fase["inc"]:
                    _crear_incidentes(client, op_h, fase["inc"])
                if fase["nodos"]:
                    _crear_nodos(client, ente_h, fase["nodos"])

            if n < total:
                print(f"  ... {PHASE_DELAY}s → siguiente fase")
                time.sleep(PHASE_DELAY)

    print("\n  OK Demo completo — datos del terremoto de Cali Ago 2026 inyectados.")


# ---------------------------------------------------------------------------
# Main — mismo patrón de polling que seed_simulacion.py
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
    print(f"OK Polling cada {POLL_INTERVAL}s — crea un incidente en la app para disparar la demo.")
    print(f"   PHASE_DELAY={PHASE_DELAY}s  ITEM_DELAY={ITEM_DELAY}s")
    print("   (Ctrl+C para salir)\n")

    try:
        while True:
            time.sleep(POLL_INTERVAL)

            with conn.cursor() as cur:
                conteo_actual = contar_necesidades(cur)

            if conteo_actual > conteo_anterior:
                print(f"\nDetectado nuevo incidente ({conteo_anterior} -> {conteo_actual}) — iniciando demo...")
                conteo_anterior = conteo_actual

                try:
                    inyectar(conn)
                except Exception as exc:
                    print(f"  ERROR: {exc}", file=sys.stderr)

    except KeyboardInterrupt:
        print("\nDetenido por el usuario.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
