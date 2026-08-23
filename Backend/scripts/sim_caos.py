#!/usr/bin/env python3
"""
sim_caos.py

Simulación caótica de emergencias en Cali — varios incidentes y nodos
afectados en paralelo, cada uno con su propio ciclo de vida desordenado.

Ciclo de cada caso:
  1. Crea incidente  (estado: pendiente → en_atencion inmediato)
  2. Crea nodo_afectado asociado (IA extrae recursos → Celery asigna → arcos)
  3. Espera tiempo aleatorio
  4. Lo cierra como "resuelto"

Fase 0 (setup): siembra puntos de acopio con stock para que Celery
tenga de dónde asignar recursos y aparezcan los arcos animados.

Varias oleadas se solapan reproduciendo el desorden real de un desastre.

Uso:
    cd Backend
    uv run python scripts/sim_caos.py
    uv run python scripts/sim_caos.py --oleadas 4 --por-oleada 5 --delay-max 45
"""

import argparse
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env.dev")

API_BASE = "http://localhost:8000/api/v1"

CREDS = {
    "admin":    {"email": "admin@sogr.gov.co",         "password": "admin123"},
    "operador": {"email": "operador@sogr.gov.co",       "password": "operador123"},
    "ente":     {"email": "ente.alcaldia@sogr.gov.co", "password": "ente123"},
}

# ---------------------------------------------------------------------------
# Infraestructura logística que se siembra ANTES del caos (Fase 0)
# Sin stock en puntos de acopio, Celery no puede asignar → sin arcos
# ---------------------------------------------------------------------------
ACOPIOS_SIM = [
    {
        "nombre": "SIM · Acopio Centro-Norte Cali",
        "tipo": "acopio", "lat": 3.4700, "lng": -76.5200,
        "direccion": "Calle 52 con Carrera 3N", "horario": "24 Horas",
    },
    {
        "nombre": "SIM · Acopio Oriente Aguablanca",
        "tipo": "acopio", "lat": 3.4050, "lng": -76.4880,
        "direccion": "Cra 34 con Calle 40", "horario": "24 Horas",
    },
    {
        "nombre": "SIM · Albergue Sur Ciudad Jardín",
        "tipo": "albergue", "lat": 3.3700, "lng": -76.5300,
        "direccion": "Av. Pasoancho con Calle 16", "horario": "24 Horas",
    },
    {
        "nombre": "SIM · Acopio Ladera Occidental",
        "tipo": "acopio", "lat": 3.4300, "lng": -76.5600,
        "direccion": "Vía Siloé sector Alto", "horario": "06:00–22:00",
    },
    {
        "nombre": "SIM · Puesto Mando Central",
        "tipo": "comando", "lat": 3.4516, "lng": -76.5320,
        "direccion": "Alcaldía de Cali, Calle 11 # 6-45", "horario": "24 Horas",
    },
    {
        "nombre": "SIM · Acopio Norte Salomia",
        "tipo": "acopio", "lat": 3.4920, "lng": -76.5100,
        "direccion": "Carrera 8 con Calle 70", "horario": "24 Horas",
    },
]

# Recursos que se cargan en cada acopio — cubre la mayoría de necesidades de emergencia
RECURSOS_BASE = [
    ("agua potable",          500, 300),
    ("alimentos no perecibles", 400, 250),
    ("kit de higiene",        200, 150),
    ("colchonetas",           150, 100),
    ("cobijas",               180, 120),
    ("botiquín primeros auxilios", 80, 50),
    ("medicamentos básicos",  120, 80),
    ("mascarillas N95",       300, 200),
    ("camillas",               30, 20),
    ("agua",                  600, 400),
    ("alimentos",             500, 300),
]

# ---------------------------------------------------------------------------
# Pool de escenarios de emergencia en Cali (coords reales)
# ---------------------------------------------------------------------------
ESCENARIOS = [
    {
        "barrio": "Siloé",
        "lat": 3.4260, "lng": -76.5650, "urgencia": 5,
        "testimonio": "[SIM] Derrumbe de ladera sobre viviendas en Siloé, al menos 3 casas sepultadas, personas atrapadas bajo escombros",
        "titulo": "SIM · Siloé · Derrumbe de ladera",
        "descripcion": "Deslizamiento de tierra por lluvias afectó 3 viviendas en zona alta de Siloé",
        "necesidad": "rescate inmediato, maquinaria, camillas, agua potable, atención médica",
        "severidad": 5, "personas_afectadas": 45,
    },
    {
        "barrio": "Aguablanca",
        "lat": 3.4015, "lng": -76.4820, "urgencia": 4,
        "testimonio": "[SIM] Inundación por desbordamiento del río Cauca en Aguablanca, familias en techos esperando rescate",
        "titulo": "SIM · Aguablanca · Inundación río Cauca",
        "descripcion": "Crecida súbita del río Cauca inundó sectores de Aguablanca hasta 1.5 m de altura",
        "necesidad": "botes de rescate, colchonetas, alimentos, kit de aseo, atención médica",
        "severidad": 4, "personas_afectadas": 320,
    },
    {
        "barrio": "Ciudad Jardín",
        "lat": 3.3645, "lng": -76.5255, "urgencia": 3,
        "testimonio": "[SIM] Incendio estructural en bodega industrial de Ciudad Jardín, humo tóxico, bomberos en escena",
        "titulo": "SIM · Ciudad Jardín · Incendio bodega",
        "descripcion": "Incendio en bodega de materiales plásticos genera columna de humo tóxico sobre residencias aledañas",
        "necesidad": "evacuación del sector, mascarillas N95, atención médica, agua",
        "severidad": 3, "personas_afectadas": 80,
    },
    {
        "barrio": "El Vallado",
        "lat": 3.3860, "lng": -76.5460, "urgencia": 5,
        "testimonio": "[SIM] Colapso parcial de edificio de 5 pisos en El Vallado, grietas estructurales visibles, vecinos evacuados",
        "titulo": "SIM · El Vallado · Colapso parcial edificio",
        "descripcion": "Edificio residencial de 5 pisos presenta colapso parcial del tercer piso, posibles víctimas bajo escombros",
        "necesidad": "equipos USAR, ambulancias, apuntalamiento estructural, camillas, botiquín primeros auxilios",
        "severidad": 5, "personas_afectadas": 60,
    },
    {
        "barrio": "Petecuy",
        "lat": 3.4380, "lng": -76.4980, "urgencia": 4,
        "testimonio": "[SIM] Explosión de gas domiciliario destruyó 2 casas en Petecuy, hay heridos con quemaduras, 1 desaparecido",
        "titulo": "SIM · Petecuy · Explosión gas domiciliario",
        "descripcion": "Fuga de gas natural explosionó en vivienda afectando dos casas contiguas y dejando heridos graves",
        "necesidad": "atención quemados, aislamiento del sector, botiquín primeros auxilios, medicamentos básicos, ambulancias",
        "severidad": 4, "personas_afectadas": 18,
    },
    {
        "barrio": "La Flora",
        "lat": 3.4700, "lng": -76.5050, "urgencia": 2,
        "testimonio": "[SIM] Rotura de tubería principal de acueducto en La Flora, sin agua hace 8 horas, adultos mayores en riesgo",
        "titulo": "SIM · La Flora · Corte masivo agua potable",
        "descripcion": "Rotura en tubería de 18 pulgadas dejó sin agua potable a más de 2.000 familias del sector norte",
        "necesidad": "agua potable, kit de higiene, colchonetas para albergue temporal",
        "severidad": 2, "personas_afectadas": 2100,
    },
    {
        "barrio": "Marroquín",
        "lat": 3.3980, "lng": -76.5120, "urgencia": 3,
        "testimonio": "[SIM] Accidente masivo en la vía Cali-Palmira, múltiples heridos, vía bloqueada en ambos sentidos",
        "titulo": "SIM · Marroquín · Accidente masivo vial",
        "descripcion": "Choque en cadena de 4 vehículos deja 12 heridos y bloquea completamente la vía Cali-Palmira",
        "necesidad": "botiquín primeros auxilios, medicamentos básicos, camillas, atención médica urgencias",
        "severidad": 3, "personas_afectadas": 12,
    },
    {
        "barrio": "Pance",
        "lat": 3.3410, "lng": -76.5540, "urgencia": 4,
        "testimonio": "[SIM] Crecida súbita del río Pance atrapó bañistas, al menos 5 personas desaparecidas aguas abajo",
        "titulo": "SIM · Pance · Crecida río y desaparecidos",
        "descripcion": "Crecida repentina del río Pance arrastró a bañistas recreacionales, rescate acuático activo",
        "necesidad": "rescate acuático, camillas, botiquín primeros auxilios, cobijas, agua potable",
        "severidad": 4, "personas_afectadas": 5,
    },
    {
        "barrio": "Alfonso López",
        "lat": 3.4130, "lng": -76.5000, "urgencia": 3,
        "testimonio": "[SIM] Incendio forestal en ladera oriental amenaza barrio Alfonso López, viento fuerte propaga el fuego",
        "titulo": "SIM · Alfonso López · Incendio forestal",
        "descripcion": "Incendio forestal de 10 hectáreas avanza hacia zona residencial empujado por viento de 40 km/h",
        "necesidad": "mascarillas N95, evacuación preventiva, agua, alimentos para damnificados, cobijas",
        "severidad": 3, "personas_afectadas": 500,
    },
    {
        "barrio": "Junín",
        "lat": 3.4560, "lng": -76.5320, "urgencia": 2,
        "testimonio": "[SIM] Brote de intoxicación masiva en restaurante de Junín, 30 personas con síntomas gastrointestinales graves",
        "titulo": "SIM · Junín · Intoxicación alimentaria masiva",
        "descripcion": "Brote de intoxicación alimentaria en restaurante del centro afecta a 30 personas con cuadros severos",
        "necesidad": "medicamentos básicos, botiquín primeros auxilios, agua potable, atención médica",
        "severidad": 2, "personas_afectadas": 30,
    },
    {
        "barrio": "Libertadores",
        "lat": 3.4450, "lng": -76.5100, "urgencia": 4,
        "testimonio": "[SIM] Derrumbe de muro de contención en Libertadores, calle principal bloqueada y 2 casas con daños severos",
        "titulo": "SIM · Libertadores · Derrumbe muro contención",
        "descripcion": "Muro de contención de 80 metros colapsó sobre vía principal dejando barrio sin acceso vehicular",
        "necesidad": "camillas, botiquín primeros auxilios, agua potable, alimentos para familias reubicadas",
        "severidad": 4, "personas_afectadas": 25,
    },
    {
        "barrio": "Vía Buenaventura",
        "lat": 3.5020, "lng": -76.5870, "urgencia": 5,
        "testimonio": "[SIM] Deslizamiento masivo bloqueó la vía Cali-Buenaventura en el km 78, decenas de vehículos atrapados",
        "titulo": "SIM · Vía Cali-BUN · Deslizamiento km 78",
        "descripcion": "Deslizamiento de 3.000 m³ de tierra bloquea totalmente la vía al Pacífico, personas varadas y heridas",
        "necesidad": "camillas, agua potable, alimentos no perecibles, cobijas, medicamentos básicos, atención médica móvil",
        "severidad": 5, "personas_afectadas": 200,
    },
]

# Color ANSI para consola
VERDE    = "\033[92m"
AMARILLO = "\033[93m"
ROJO     = "\033[91m"
CYAN     = "\033[96m"
GRIS     = "\033[90m"
RESET    = "\033[0m"
NEGRITA  = "\033[1m"

_lock_print = threading.Lock()


def log(msg: str, color: str = RESET) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    with _lock_print:
        print(f"{GRIS}[{ts}]{RESET} {color}{msg}{RESET}", flush=True)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _login(client: httpx.Client, role: str) -> dict:
    r = client.post(f"{API_BASE}/auth/login", json=CREDS[role], timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _get_ente_id(client: httpx.Client, admin_h: dict) -> str:
    r = client.get(f"{API_BASE}/users", headers=admin_h, timeout=10)
    r.raise_for_status()
    for u in r.json():
        if u["email"] == CREDS["ente"]["email"]:
            return u["id"]
    raise RuntimeError("Usuario ente no encontrado — corre seed_users.py primero")


# ---------------------------------------------------------------------------
# Fase 0: infraestructura logística (puntos de acopio + stock)
# ---------------------------------------------------------------------------

def setup_infraestructura(client: httpx.Client, admin_h: dict, op_h: dict, ente_id: str) -> None:
    log(f"{NEGRITA}── Fase 0: sembrando infraestructura logística ──{RESET}", NEGRITA)

    # Obtener puntos ya existentes para no duplicar
    r = client.get(f"{API_BASE}/puntos-control", timeout=15)
    existentes = {p["nombre"]: p["id"] for p in (r.json() if r.status_code == 200 else [])}

    punto_ids: dict[str, str] = {}

    for acopio in ACOPIOS_SIM:
        nombre = acopio["nombre"]
        if nombre in existentes:
            punto_ids[nombre] = existentes[nombre]
            log(f"  skip (ya existe)  {nombre}", GRIS)
            continue

        payload = {**acopio, "responsable_user_id": ente_id, "verificado": True}
        r2 = client.post(f"{API_BASE}/puntos-control", json=payload, headers=admin_h, timeout=20)
        if r2.status_code in (200, 201):
            pid = r2.json()["id"]
            punto_ids[nombre] = pid
            log(f"  {VERDE}OK{RESET}  {acopio['tipo']:8}  {nombre}", GRIS)
        else:
            log(f"  WARN punto {nombre}: {r2.status_code}", AMARILLO)
        time.sleep(0.3)

    # Cargar stock en paralelo (todos los combos punto×recurso a la vez)
    log("  Cargando inventario en puntos de acopio...", GRIS)
    tareas = [
        {"punto_id": pid, "nombre_recurso": recurso,
         "cantidad_actual": cant_actual, "cantidad_necesaria": cant_necesaria}
        for _, pid in punto_ids.items()
        for recurso, cant_actual, cant_necesaria in RECURSOS_BASE
    ]

    def _registrar(payload: dict) -> bool:
        try:
            with httpx.Client(timeout=20.0, http2=False) as hc:
                r = hc.post(f"{API_BASE}/recursos/registrar", json=payload, headers=op_h)
                return r.status_code in (200, 201)
        except Exception:
            return False

    ok_inv = 0
    with ThreadPoolExecutor(max_workers=12) as pool:
        for resultado in as_completed([pool.submit(_registrar, t) for t in tareas]):
            if resultado.result():
                ok_inv += 1

    log(f"  {VERDE}{ok_inv} items de stock cargados en {len(punto_ids)} puntos{RESET}", VERDE)
    log(f"{NEGRITA}── Infraestructura lista → iniciando caos ──{RESET}\n", NEGRITA)


# ---------------------------------------------------------------------------
# Ciclo de vida de un caso de emergencia
# ---------------------------------------------------------------------------

def simular_caso(
    escenario: dict,
    op_h: dict,
    delay_min: int,
    delay_max: int,
    caso_num: int,
) -> None:
    """Ejecuta el ciclo completo de un caso de emergencia en su propio hilo."""
    barrio = escenario["barrio"]
    tag = f"#{caso_num:02d} [{barrio}]"

    # Un Client por hilo, sin keep-alive para evitar reusar conexiones muertas
    # tras un 500 que cierra el TCP en el servidor
    with httpx.Client(timeout=60.0, http2=False) as c:

        # 1. Crear incidente (pendiente)
        payload_inc = {
            "testimonio":      escenario["testimonio"],
            "lat":             escenario["lat"],
            "lng":             escenario["lng"],
            "barrio":          barrio,
            "urgencia_manual": escenario["urgencia"],
        }
        try:
            r = c.post(f"{API_BASE}/incidentes", json=payload_inc, headers=op_h)
        except Exception as exc:
            log(f"{tag}  ERROR red creando incidente: {exc}", ROJO)
            return
        if r.status_code not in (200, 201):
            log(f"{tag}  ERROR creando incidente: {r.status_code} {r.text[:80]}", ROJO)
            return

        inc = r.json()
        inc_id = inc["id"]
        log(f"{tag}  {NEGRITA}CREADO{RESET}{AMARILLO}  urgencia={inc.get('urgencia')} tipo={str(inc.get('tipo',''))[:20]}", AMARILLO)

        # Pausa corta aleatoria antes de pasar a en_atencion
        time.sleep(random.uniform(0.3, 1.5))

        # 2. pendiente → en_atencion de inmediato
        try:
            r2 = c.patch(
                f"{API_BASE}/incidentes/{inc_id}/estado",
                json={"estado": "en_atencion"},
                headers=op_h,
            )
            if r2.status_code in (200, 201):
                log(f"{tag}  {NEGRITA}EN ATENCIÓN{RESET}{CYAN}", CYAN)
            else:
                log(f"{tag}  WARN en_atencion: {r2.status_code}", AMARILLO)
        except Exception as exc:
            log(f"{tag}  WARN red en_atencion: {exc}", AMARILLO)

        # 4. Esperar tiempo ALEATORIO (el desorden entre casos)
        espera = random.uniform(delay_min, delay_max)
        log(f"{tag}  en atención {espera:.0f}s...", GRIS)
        time.sleep(espera)

        # 5. en_atencion → resuelto
        try:
            r4 = c.patch(
                f"{API_BASE}/incidentes/{inc_id}/estado",
                json={"estado": "resuelto"},
                headers=op_h,
            )
            if r4.status_code in (200, 201):
                log(f"{tag}  {NEGRITA}RESUELTO ✓{RESET}{VERDE}", VERDE)
            else:
                log(f"{tag}  WARN al resolver: {r4.status_code} {r4.text[:60]}", ROJO)
        except Exception as exc:
            log(f"{tag}  WARN red resolver: {exc}", ROJO)


# ---------------------------------------------------------------------------
# Limpieza: borra todo lo que creó esta simulación
# ---------------------------------------------------------------------------

def _delete(url: str, headers: dict) -> bool:
    try:
        with httpx.Client(timeout=15.0, http2=False) as c:
            r = c.delete(url, headers=headers)
            return r.status_code in (200, 204)
    except Exception:
        return False


def limpiar_simulacion(admin_h: dict, op_h: dict) -> None:
    log(f"\n{NEGRITA}── Limpiando datos de la simulación ──{RESET}", NEGRITA)

    with httpx.Client(timeout=20.0, http2=False) as c:
        # Incidentes [SIM]
        try:
            r = c.get(f"{API_BASE}/incidentes", headers=op_h)
            incs_sim = [i["id"] for i in r.json() if str(i.get("testimonio", "")).startswith("[SIM]")]
        except Exception:
            incs_sim = []

        # Nodos afectados [SIM ·]
        try:
            r = c.get(f"{API_BASE}/nodos-afectados", headers=admin_h)
            nodos_sim = [n["id"] for n in r.json() if str(n.get("titulo", "")).startswith("SIM ·")]
        except Exception:
            nodos_sim = []

        # Puntos de control SIM ·
        try:
            r = c.get(f"{API_BASE}/puntos-control", headers=admin_h)
            puntos_sim = [p["id"] for p in r.json() if str(p.get("nombre", "")).startswith("SIM ·")]
        except Exception:
            puntos_sim = []

    tareas_borrado = (
        [(f"{API_BASE}/incidentes/{i}", op_h)    for i in incs_sim]
        + [(f"{API_BASE}/nodos-afectados/{n}", admin_h) for n in nodos_sim]
        + [(f"{API_BASE}/puntos-control/{p}", admin_h)  for p in puntos_sim]
    )

    ok = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        futuros = [pool.submit(_delete, url, h) for url, h in tareas_borrado]
        for f in as_completed(futuros):
            if f.result():
                ok += 1

    log(
        f"  borrados: {len(incs_sim)} incidentes, {len(nodos_sim)} nodos, "
        f"{len(puntos_sim)} puntos de acopio  ({ok}/{len(tareas_borrado)} OK)",
        VERDE,
    )


# ---------------------------------------------------------------------------
# Orquestador: oleadas de casos concurrentes
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Simulación caótica de emergencias SOGR")
    parser.add_argument("--oleadas",       type=int,   default=3,   help="Número de oleadas (default 3)")
    parser.add_argument("--por-oleada",    type=int,   default=4,   help="Casos por oleada (default 4)")
    parser.add_argument("--delay-min",     type=int,   default=5,   help="Segundos mín en atención antes de resolver (default 5)")
    parser.add_argument("--delay-max",     type=int,   default=20,  help="Segundos máx en atención antes de resolver (default 20)")
    parser.add_argument("--entre-oleadas", type=float, default=4.0, help="Segundos entre oleadas (default 4)")
    parser.add_argument("--sin-setup",     action="store_true",     help="Saltar la fase 0 de infraestructura")
    args = parser.parse_args()

    print(f"\n{NEGRITA}{'='*60}{RESET}")
    print(f"{NEGRITA}  SOGR · Simulación Caótica de Emergencias{RESET}")
    print(f"  {args.oleadas} oleadas × {args.por_oleada} casos = {args.oleadas * args.por_oleada} incidentes")
    print(f"  Tiempo en atención: {args.delay_min}–{args.delay_max}s aleatorio por caso")
    print(f"  Entre oleadas: {args.entre_oleadas}s  (se solapan)")
    print(f"{NEGRITA}{'='*60}{RESET}\n")

    log("Autenticando...", GRIS)
    for intento in range(1, 5):
        try:
            with httpx.Client(timeout=20.0, http2=False) as auth_client:
                admin_h = _login(auth_client, "admin")
                op_h    = _login(auth_client, "operador")
                ente_h  = _login(auth_client, "ente")
                ente_id = _get_ente_id(auth_client, admin_h)
            break
        except Exception as e:
            if intento == 4:
                print(f"{ROJO}ERROR de autenticación tras 4 intentos: {e}{RESET}", file=sys.stderr)
                sys.exit(1)
            log(f"  reintento {intento}/3 ({e})", AMARILLO)
            time.sleep(2 * intento)
    log("Autenticación OK\n", VERDE)

    # Fase 0: infraestructura logística
    if not args.sin_setup:
        with httpx.Client(timeout=60.0) as setup_client:
            setup_infraestructura(setup_client, admin_h, op_h, ente_id)

    todos_hilos: list[threading.Thread] = []
    pool = ESCENARIOS.copy()
    caso_num = 0

    for oleada_i in range(1, args.oleadas + 1):
        log(f"{NEGRITA}── Oleada {oleada_i}/{args.oleadas} ──────────────────────{RESET}", NEGRITA)

        if len(pool) < args.por_oleada:
            pool = ESCENARIOS.copy()
            random.shuffle(pool)
        escenarios_oleada = random.sample(pool, min(args.por_oleada, len(pool)))
        for e in escenarios_oleada:
            pool.remove(e)

        for escenario in escenarios_oleada:
            caso_num += 1
            time.sleep(random.uniform(0.1, 0.8))
            t = threading.Thread(
                target=simular_caso,
                args=(escenario, op_h, args.delay_min, args.delay_max, caso_num),
                daemon=True,
                name=f"caso-{caso_num}",
            )
            t.start()
            todos_hilos.append(t)

        if oleada_i < args.oleadas:
            log(f"  próxima oleada en {args.entre_oleadas}s...", GRIS)
            time.sleep(args.entre_oleadas)

    log("\nTodas las oleadas lanzadas. Esperando que terminen...\n", GRIS)
    for t in todos_hilos:
        t.join()

    log(f"{NEGRITA}Simulación completa — {caso_num} casos procesados ✓{RESET}", VERDE)

    # Limpieza automática: borrar todo lo que creó esta simulación
    limpiar_simulacion(admin_h, op_h)


if __name__ == "__main__":
    main()
