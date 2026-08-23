#!/usr/bin/env python3
"""
live_demo.py

Simulación temporizada del terremoto de Cali del 10 de agosto de 2026
(M7.4, epicentro San José del Palmar, Chocó).

El script espera a que un operador cree el primer incidente real en la app
y luego inyecta 5 fases en orden cronológico:

  Fase 1 · Ago 10 07:34 AM — Hora Cero: 20 reportes de colapso simultáneos
  Fase 2 · Ago 10 08:00 AM — Segunda ola: 15 reportes + 12 puntos comunitarios
  Fase 3 · Ago 10 (tarde) — Infraestructura oficial: 6 reportes + 18 puntos
  Fase 4 · Ago 11-13      — Evaluación técnica: 5 reportes + cierre transitorios
  Fase 5 · Ago 18-21      — Gas + réplica + normalización

Los 46 incidentes se crean en PARALELO (ThreadPoolExecutor) para que la IA
procese todos los testimonios en ~15 s en lugar de ~5 min secuenciales.
Los puntos de control se crean secuencialmente (endpoint sin IA, < 50 ms c/u).

Idempotente: testimonios con prefijo '[DEMO]' indican inyección previa.

Uso:
    cd Backend
    set -a && source .env && set +a
    uv run python scripts/live_demo.py
"""

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
POLL_INTERVAL = 3       # segundos entre polls de la DB

PHASE_DELAY      = 8    # segundos entre fases (narrativa del desastre)
ITEM_DELAY       = 0    # puntos de control son < 50 ms, sin pausa extra
INCIDENT_WORKERS = 8    # hilos paralelos para las llamadas IA de incidentes

CREDS = {
    "admin":    {"email": "admin@sogr.gov.co",         "password": "admin123"},
    "ente":     {"email": "ente.alcaldia@sogr.gov.co", "password": "ente123"},
    "operador": {"email": "operador@sogr.gov.co",       "password": "operador123"},
}

NOMBRES_TRANSITORIOS = [
    "Plazoleta Jairo Varela",
    "Escuela Nacional del Deporte",
    "Parque de la Caña",
]

# ---------------------------------------------------------------------------
# Fase 1 — Ago 10 · 07:34 AM · "Hora Cero"
# 20 reportes de colapso estructural. Sin puntos de ayuda todavía.
# ---------------------------------------------------------------------------

INC_FASE1 = [
    {"testimonio": "[DEMO] Estoy frente al edificio Torres del Limonar en la Calle 5 con Carrera 36, colapsó completamente, escucho gritos bajo los escombros, hay personas atrapadas, necesitamos brigadas de rescate y ambulancias ya",
     "lat": 3.4042, "lng": -76.5389, "barrio": "Limonar", "urgencia_manual": 5},

    {"testimonio": "[DEMO] Soy vecino de la Avenida 8 Norte con Calle 14 en barrio Granada, el techo y un muro lateral de un edificio de 4 pisos se desplomaron, hay una mujer atrapada bajo la losa, estamos intentando ayudarla sin equipo",
     "lat": 3.4635, "lng": -76.5265, "barrio": "Granada", "urgencia_manual": 5},

    {"testimonio": "[DEMO] Edificio de 6 pisos en Carrera 1 Norte con Calle 52 barrio Normandía, colapsaron el tercer y cuarto piso, hay gritos adentro, al menos 30 personas no han salido, estamos esperando a los bomberos",
     "lat": 3.4750, "lng": -76.5280, "barrio": "Normandía", "urgencia_manual": 5},

    {"testimonio": "[DEMO] Bloque B del conjunto Terrazas de Versalles en Carrera 5N con Calle 61, primer piso colapsó totalmente y la estructura se volcó, hay familias en los pisos de arriba que no pueden bajar",
     "lat": 3.4840, "lng": -76.5180, "barrio": "Versalles", "urgencia_manual": 5},

    {"testimonio": "[DEMO] En el sector El Cortijo de Siloé el sismo provocó un deslizamiento de tierra, ocho casas quedaron enterradas, hay personas bajo el barro, necesitamos retroexcavadoras y equipos de emergencia",
     "lat": 3.4220, "lng": -76.5580, "barrio": "Siloé", "urgencia_manual": 5},

    {"testimonio": "[DEMO] El techo del Colegio Multipropósito sede norte en Calle 70 con Carrera 8 colapsó, había docentes en turno temprano, veo a varias personas heridas en el patio, necesitamos ambulancias",
     "lat": 3.4920, "lng": -76.5100, "barrio": "Salomia", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Edificio de 1950 en Avenida 2 Norte con Calle 37 barrio Bretaña, tercer piso colapsado, hay un adulto mayor atrapado en el segundo piso, la estructura es de bahareque sin refuerzo sísmico",
     "lat": 3.4530, "lng": -76.5310, "barrio": "Bretaña", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Talud en Terrón Colorado sector La Sultana cedió por el sismo, el acceso principal está bloqueado, doce viviendas enterradas, no podemos llegar con vehículos, se necesita maquinaria pesada",
     "lat": 3.4380, "lng": -76.5600, "barrio": "Terrón Colorado", "urgencia_manual": 5},

    {"testimonio": "[DEMO] El corredor de la Calle 5 entre Carreras 36 y 44 está bloqueado por escombros de dos edificios que colapsaron al mismo tiempo, personas en balcones que no pueden bajar, acceso cortado completamente",
     "lat": 3.4280, "lng": -76.5380, "barrio": "Calle 5", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Casa de dos pisos en Carrera 15 con Calle 25 barrio Obrero colapsó completamente, una familia estaba adentro cuando ocurrió el sismo, los vecinos escuchamos golpes desde los escombros",
     "lat": 3.4450, "lng": -76.5270, "barrio": "Barrio Obrero", "urgencia_manual": 4},

    {"testimonio": "[DEMO] En Alto Nápoles el movimiento sísmico desprendió el talud sobre una manzana entera de casas, hay escombros de tierra y rocas, no podemos determinar cuántas personas estaban dentro",
     "lat": 3.4100, "lng": -76.5630, "barrio": "Alto Nápoles", "urgencia_manual": 5},

    {"testimonio": "[DEMO] En la Calle 25 con Carrera 20 barrio Villanueva, seis casas de adobe colapsaron, la comunidad dice que 22 personas no han salido ni respondido, necesitamos brigadas de rescate urgente",
     "lat": 3.4370, "lng": -76.5530, "barrio": "Villanueva", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Soy residente de Cristóbal Colón, Carrera 23 con Calle 18, seis viviendas colapsaron en media manzana, hay escombros hasta la calle, estamos buscando a nuestros vecinos sin herramientas",
     "lat": 3.4350, "lng": -76.5520, "barrio": "Cristóbal Colón", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Estoy en urgencias del Hospital Universitario del Valle, hay fisuras estructurales en las columnas del bloque de cirugías, están evacuando pacientes al parqueadero, más de mil heridos llegan desde afuera",
     "lat": 3.4300, "lng": -76.5422, "barrio": "San Fernando", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Edificio colonial de tres pisos en Carrera 6 con Calle 13 San Nicolás colapsó la fachada completa sobre la zona peatonal, hay al menos cuatro heridos visibles en el suelo",
     "lat": 3.4450, "lng": -76.5340, "barrio": "San Nicolás", "urgencia_manual": 3},

    {"testimonio": "[DEMO] El puente peatonal sobre el río Cali en barrio San Antonio cedió, la estructura metálica está en el agua, vi a dos personas caer, se necesita brigada fluvial urgente",
     "lat": 3.4480, "lng": -76.5380, "barrio": "San Antonio", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Torre 3 del conjunto Torres del Norte en Carrera 1 bis con Calle 72N, colapsó el sótano y la planta baja, edificio de 12 pisos está inclinado, estamos evacuando sin saber cuántos hay adentro",
     "lat": 3.4960, "lng": -76.5220, "barrio": "El Norte", "urgencia_manual": 5},

    {"testimonio": "[DEMO] La bodega de materiales en Chipichape Carrera 6N con Calle 38N colapsó totalmente, la estructura metálica del techo cayó, tres empleados no aparecen, los compañeros estamos intentando buscarlos",
     "lat": 3.4600, "lng": -76.5240, "barrio": "Chipichape", "urgencia_manual": 4},

    {"testimonio": "[DEMO] En el edificio Balcones de Floralia Carrera 8 con Calle 69N los balcones del cuarto y quinto piso colapsaron sobre los carros del parqueadero, hay una persona visible bajo los escombros de concreto",
     "lat": 3.4890, "lng": -76.5050, "barrio": "Floralia", "urgencia_manual": 4},

    {"testimonio": "[DEMO] La torre campanario de La Merced en Carrera 4 con Calle 12 colapsó sobre los edificios vecinos, hay heridos en la acera, el patrimonio histórico quedó en ruinas",
     "lat": 3.4420, "lng": -76.5330, "barrio": "La Merced", "urgencia_manual": 3},
]

# ---------------------------------------------------------------------------
# Fase 2 — Ago 10 · 08:00 AM · "Segunda ola + primeros puntos comunitarios"
# 15 reportes + 12 puntos de ayuda auto-organizados por la ciudadanía
# ---------------------------------------------------------------------------

INC_FASE2 = [
    {"testimonio": "[DEMO] Soy docente del Colegio Jefferson en Aranjuez Carrera 3 con Calle 48N, las paredes del patio central colapsaron, llegué temprano y hay compañeros con heridas por fragmentos, necesitamos ambulancias",
     "lat": 3.4680, "lng": -76.5260, "barrio": "Aranjuez", "urgencia_manual": 3},

    {"testimonio": "[DEMO] Nuevo deslizamiento en Siloé sector La Legión, la réplica pequeña desestabilizó más el terreno, familias que habían escapado no pueden regresar y hay heridos nuevos en la ladera",
     "lat": 3.4180, "lng": -76.5620, "barrio": "Siloé", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Estoy en Clínica Versalles Calle 5, hay fisuras en las columnas del bloque principal, el personal está evacuando quirófanos activos, las cirugías en curso se interrumpieron, necesitamos área médica alternativa",
     "lat": 3.4295, "lng": -76.5402, "barrio": "San Fernando", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Edificio de oficinas en La Flora Calle 44 con Carrera 3 colapsó dos plantas intermedias, llegué al turno de aseo y encontré el edificio en el piso, necesitan que vengan rápido hay compañeros atrapados",
     "lat": 3.4690, "lng": -76.5290, "barrio": "La Flora", "urgencia_manual": 3},

    {"testimonio": "[DEMO] En el conjunto Los Nogales en Limonar el muro perimetral y una unidad colapsaron, hay una familia de cinco personas que no ha salido, escuchamos ruidos hace diez minutos, piden excavación manual",
     "lat": 3.4010, "lng": -76.5370, "barrio": "Limonar", "urgencia_manual": 3},

    {"testimonio": "[DEMO] El edificio de la Cámara de Comercio sede norte tiene fisuras en el núcleo de escaleras, estamos evacuando pero la gente entra en pánico, necesitan orientación y acordonamiento del área",
     "lat": 3.4720, "lng": -76.5200, "barrio": "Ciudad Jardín Norte", "urgencia_manual": 3},

    {"testimonio": "[DEMO] La sala de bombas de EMCALI en El Vallado tiene el techo caído, dos operarios están heridos, el suministro de agua para el norte de Cali está en riesgo inminente",
     "lat": 3.3960, "lng": -76.5000, "barrio": "El Vallado", "urgencia_manual": 3},

    {"testimonio": "[DEMO] Clínica Nuestra Señora de los Remedios sede sur está evacuando la sala de maternidad, recién nacidos en camillas en el parqueadero, necesitamos incubadoras portátiles y traslado urgente",
     "lat": 3.3760, "lng": -76.5350, "barrio": "Ciudad Jardín", "urgencia_manual": 4},

    {"testimonio": "[DEMO] En el conjunto La Riviera barrio Meléndez el muro de contención colapsó sobre el parqueadero, cinco carros aplastados, estamos verificando que no haya personas bajo los vehículos",
     "lat": 3.3880, "lng": -76.5500, "barrio": "Meléndez", "urgencia_manual": 3},

    {"testimonio": "[DEMO] El bloque D de la Universidad Santiago de Cali en Pampalinda tiene las columnas con daños graves, la rectoría ordenó evacuación total, hay estudiantes de posgrado que llegaron temprano y no saben qué hacer",
     "lat": 3.4180, "lng": -76.5500, "barrio": "Pampalinda", "urgencia_manual": 3},

    {"testimonio": "[DEMO] En barrio El Paraíso occidente, varias casas de un piso en adobe colapsaron, las familias de escasos recursos no tenían construcciones sismoresistentes, hay adultos mayores solos sin poder salir",
     "lat": 3.4150, "lng": -76.5600, "barrio": "El Paraíso", "urgencia_manual": 4},

    {"testimonio": "[DEMO] El edificio de la Gobernación del Valle tiene fisuras en las escaleras de emergencia y la subestación eléctrica falló, estamos trasladando operaciones al PMU alterno, la atención a ciudadanos está interrumpida",
     "lat": 3.4440, "lng": -76.5310, "barrio": "Centro Cívico", "urgencia_manual": 2},

    {"testimonio": "[DEMO] La fachada de vidrio del Banco de Bogotá sede Calima colapsó sobre la acera en la Calle 8, hay tres transeúntes heridos, la vía está cortada entre Carreras 8 y 10 por los vidrios",
     "lat": 3.4340, "lng": -76.5280, "barrio": "Calima", "urgencia_manual": 3},

    {"testimonio": "[DEMO] Conjunto residencial en Floralia Norte tiene colapso masivo de balcones del cuarto y quinto piso, vehículos del parqueadero aplastados, hay una persona visible bajo escombros de concreto pesado",
     "lat": 3.4895, "lng": -76.5060, "barrio": "Floralia Norte", "urgencia_manual": 4},

    {"testimonio": "[DEMO] Barrio Guaduales carrera 8 con calle 32, varias casas de dos pisos colapsadas, hay escombros bloqueando la calle principal, familias con niños pequeños esperan en la acera sin abrigo ni agua",
     "lat": 3.4250, "lng": -76.5450, "barrio": "Guaduales", "urgencia_manual": 3},
]

PUNTOS_FASE2 = [
    {"nombre": "Parroquia Juan Pablo II",        "tipo": "acopio",   "lat": 3.4458, "lng": -76.5371,
     "direccion": "Carrera 4N # 26N-35, San Antonio",       "horario": "Voluntarios 08:00–22:00"},
    {"nombre": "Restaurante Lengua de Mariposa", "tipo": "acopio",   "lat": 3.4455, "lng": -76.5368,
     "direccion": "Barrio San Antonio",                      "horario": "Comidas 12:00–20:00"},
    {"nombre": "Colegio Berchmans",              "tipo": "albergue", "lat": 3.4710, "lng": -76.5230,
     "direccion": "Calle 53N # 3-43, Normandía",             "horario": "24 Horas"},
    {"nombre": "Sede Comfandi Chipichape",        "tipo": "acopio",   "lat": 3.4615, "lng": -76.5235,
     "direccion": "Calle 38N # 6N-35",                       "horario": "08:00–20:00"},
    {"nombre": "Parroquia San Rafael Arcángel",  "tipo": "acopio",   "lat": 3.4520, "lng": -76.5290,
     "direccion": "Av. 3N # 31N-12, Granada",                "horario": "07:00–22:00"},
    {"nombre": "Salón Comunal Normandía",         "tipo": "acopio",   "lat": 3.4745, "lng": -76.5270,
     "direccion": "Carrera 1A Norte # 50-20",                "horario": "08:00–18:00"},
    {"nombre": "Colegio Liceo de Occidente",      "tipo": "albergue", "lat": 3.4340, "lng": -76.5560,
     "direccion": "Calle 24 # 18-30, La Floresta",           "horario": "24 Horas"},
    {"nombre": "Centro Comunitario Siloé",        "tipo": "acopio",   "lat": 3.4200, "lng": -76.5590,
     "direccion": "Carrera 22 # 24-10, Siloé",               "horario": "08:00–20:00"},
    {"nombre": "Parque Lineal La Vorágine",       "tipo": "albergue", "lat": 3.4420, "lng": -76.5330,
     "direccion": "Calle 8A # 33-00",                        "horario": "Carpas desde Ago 10"},
    {"nombre": "Liga Fútbol Valle del Cauca",     "tipo": "acopio",   "lat": 3.4550, "lng": -76.5200,
     "direccion": "Calle 13N # 2N-29",                       "horario": "08:00–18:00"},
    {"nombre": "Parroquia Cristo Rey",            "tipo": "acopio",   "lat": 3.4310, "lng": -76.5490,
     "direccion": "Cra. 17 # 8-48, Barrio Obrero",           "horario": "07:00–21:00"},
    {"nombre": "Universidad San Buenaventura",    "tipo": "albergue", "lat": 3.4170, "lng": -76.5500,
     "direccion": "La Umbría, Autopista Sur",                 "horario": "24 Horas"},
]

INVENTARIO_FASE2 = [
    ("Parroquia Juan Pablo II", "colchonetas", 30, 100),
    ("Parroquia Juan Pablo II", "agua",        20,  80),
    ("Parroquia Juan Pablo II", "linternas",   15,  30),
    ("Parroquia Juan Pablo II", "guantes",     20,  50),
    ("Parroquia Juan Pablo II", "cobijas",     40, 120),
]

# ---------------------------------------------------------------------------
# Fase 3 — Ago 10 (tarde) · "Infraestructura oficial del Estado"
# 6 reportes de evaluación técnica + 18 puntos oficiales + inventario
# ---------------------------------------------------------------------------

INC_FASE3 = [
    {"testimonio": "[DEMO] Los inspectores de la Curaduría Urbana confirmamos 24 edificios con colapso total en Cali, la mayoría en comunas 2, 6 y 19 donde los suelos blandos amplificaron el sismo, iniciamos catastro puerta a puerta",
     "lat": 3.4700, "lng": -76.5200, "barrio": "Norte General", "urgencia_manual": 2},

    {"testimonio": "[DEMO] La torre de telecomunicaciones en el cerro Las Tres Cruces tiene falla en la base de anclaje, hay riesgo de caída sobre el barrio Granada, los bomberos estamos estableciendo perímetro de seguridad",
     "lat": 3.4480, "lng": -76.5190, "barrio": "Las Tres Cruces", "urgencia_manual": 3},

    {"testimonio": "[DEMO] Un muro medianero en Junín Carrera 11 con Calle 9 que parecía estable colapsó a las 36 horas del sismo, la estructura vecina también está en riesgo inminente, necesitamos acordonamiento urgente",
     "lat": 3.4460, "lng": -76.5360, "barrio": "Junín", "urgencia_manual": 3},

    {"testimonio": "[DEMO] Soy operador del MIO y reporto grietas activas en la infraestructura del corredor Calle 5, la vía principal está bloqueada, redirigimos rutas pero hay caos total de movilidad en la ciudad",
     "lat": 3.4260, "lng": -76.5360, "barrio": "Calle 5", "urgencia_manual": 2},

    {"testimonio": "[DEMO] En la Universidad del Valle campus Meléndez el bloque de ingenierías tiene fisuras graves en columnas del tercer piso, evacuamos sin heridos pero la estructura es inestable y no podemos volver a entrar",
     "lat": 3.3700, "lng": -76.5380, "barrio": "Meléndez", "urgencia_manual": 2},

    {"testimonio": "[DEMO] La bodega del SENA sede sur tiene colapso de cubierta en el bloque de talleres, los trabajadores evacuaron sin heridos graves, pero hay riesgo de fuga de gas en el área de soldadura",
     "lat": 3.3920, "lng": -76.5450, "barrio": "Sur", "urgencia_manual": 2},
]

PUNTOS_FASE3 = [
    {"nombre": "Ciudadela Petronio Álvarez",          "tipo": "acopio",   "lat": 3.4142, "lng": -76.5519,
     "direccion": "Cra. 56 con Calle 3, C.D. Alberto Galindo",  "horario": "08:00–12:00 / 14:00–18:00"},
    {"nombre": "Cancha de Hockey Miguel Calero",      "tipo": "albergue", "lat": 3.4250, "lng": -76.5389,
     "direccion": "Calle 9 # 37-00, Unidad Deportiva",          "horario": "24 Horas"},
    {"nombre": "Diamante de Béisbol",                 "tipo": "albergue", "lat": 3.4228, "lng": -76.5347,
     "direccion": "Unidad Deportiva Jaime Aparicio",             "horario": "24 Horas"},
    {"nombre": "Coliseo Metropolitano del Norte",     "tipo": "albergue", "lat": 3.4792, "lng": -76.5028,
     "direccion": "Cancha cubierta Sector Chiminangos",          "horario": "24 Horas"},
    {"nombre": "CIDES Parque Los Pinos",              "tipo": "albergue", "lat": 3.3778, "lng": -76.5542,
     "direccion": "Comuna 18",                                   "horario": "24 Horas"},
    {"nombre": "Plazoleta Jairo Varela",              "tipo": "acopio",   "lat": 3.4558, "lng": -76.5310,
     "direccion": "Av. 2 Norte # 10 Norte-1, Granada",           "horario": "Transitorio"},
    {"nombre": "Escuela Nacional del Deporte",        "tipo": "acopio",   "lat": 3.4264, "lng": -76.5371,
     "direccion": "Calle 9 # 34-01, Sector Eucarístico",         "horario": "Transitorio"},
    {"nombre": "Parque de la Caña",                   "tipo": "acopio",   "lat": 3.4542, "lng": -76.5089,
     "direccion": "Carrera 8 # 39-01",                           "horario": "Transitorio"},
    {"nombre": "SENA Regional Cali Salomia",          "tipo": "acopio",   "lat": 3.4900, "lng": -76.5100,
     "direccion": "Calle 52N # 2N-29, Salomia",                  "horario": "07:00–19:00"},
    {"nombre": "Batallón Pichincha",                  "tipo": "comando",  "lat": 3.4430, "lng": -76.5250,
     "direccion": "Calle 9 # 15-00, Sector Militar",             "horario": "24 Horas"},
    {"nombre": "Terminal de Transportes Cali",        "tipo": "albergue", "lat": 3.4155, "lng": -76.5264,
     "direccion": "Calle 30N # 2A-29",                           "horario": "24 Horas"},
    {"nombre": "Colegio Próspero Pinzón",             "tipo": "acopio",   "lat": 3.4680, "lng": -76.5310,
     "direccion": "Calle 53N # 1-50, Normandía",                 "horario": "08:00–18:00"},
    {"nombre": "Institución Educativa Multipropósito","tipo": "acopio",   "lat": 3.4510, "lng": -76.5140,
     "direccion": "Calle 18 # 12-30",                            "horario": "08:00–18:00"},
    {"nombre": "Centro Comunitario Aguablanca",       "tipo": "acopio",   "lat": 3.4100, "lng": -76.4980,
     "direccion": "Cra. 38B # 24-68, Aguablanca",                "horario": "08:00–18:00"},
    {"nombre": "Parque El Ingenio",                   "tipo": "albergue", "lat": 3.3820, "lng": -76.5380,
     "direccion": "Av. Las Américas, Ciudad Jardín",             "horario": "Carpas desde Ago 10"},
    {"nombre": "Club Colombia – Sede Cali",           "tipo": "albergue", "lat": 3.3930, "lng": -76.5310,
     "direccion": "Autopista Sur Km 14",                         "horario": "24 Horas"},
    {"nombre": "Centro Médico Dávila",                "tipo": "hospital", "lat": 3.4520, "lng": -76.5270,
     "direccion": "Carrera 3 # 37N-12",                          "horario": "24 Horas"},
    {"nombre": "Fundación Éxito – Bodega Donaciones", "tipo": "acopio",   "lat": 3.4630, "lng": -76.5180,
     "direccion": "Av. 3N # 36N-00, Vipasa",                     "horario": "08:00–20:00"},
]

INVENTARIO_FASE3 = [
    ("Ciudadela Petronio Álvarez",       "alimentos no perecederos", 500, 400),
    ("Ciudadela Petronio Álvarez",       "agua",                    2000, 1000),
    ("Ciudadela Petronio Álvarez",       "colchonetas",              300,  500),
    ("Ciudadela Petronio Álvarez",       "kits de aseo",             150,  400),
    ("Ciudadela Petronio Álvarez",       "ropa",                     800,  600),
    ("Cancha de Hockey Miguel Calero",   "cobijas",      200, 300),
    ("Cancha de Hockey Miguel Calero",   "agua",          50, 200),
    ("Cancha de Hockey Miguel Calero",   "colchonetas",  100, 150),
    ("Diamante de Béisbol",              "cobijas",      180, 300),
    ("Diamante de Béisbol",              "agua",          40, 200),
    ("Diamante de Béisbol",              "colchonetas",   80, 120),
    ("Coliseo Metropolitano del Norte",  "cobijas",      250, 350),
    ("Coliseo Metropolitano del Norte",  "agua",          30, 180),
    ("Coliseo Metropolitano del Norte",  "colchonetas",  120, 160),
    ("CIDES Parque Los Pinos",           "cobijas",      160, 250),
    ("CIDES Parque Los Pinos",           "agua",          25, 150),
    ("CIDES Parque Los Pinos",           "colchonetas",   60, 100),
]

# ---------------------------------------------------------------------------
# Fase 4 — Ago 11-13 · "Evaluación técnica + cierre de transitorios"
# 5 reportes de evaluación + cierre SQL de 3 puntos transitorios + 5 puntos
# ---------------------------------------------------------------------------

INC_FASE4 = [
    {"testimonio": "[DEMO] Los accesos al sur de la ciudad acumulan más de 30.000 toneladas de escombros bloqueando vías, Secretaría de Infraestructura activa el lote EMCALI como punto de disposición, camiones esperan instrucciones",
     "lat": 3.4420, "lng": -76.5300, "barrio": "Varios", "urgencia_manual": 2},

    {"testimonio": "[DEMO] Detectamos fuga de gas en tres casas de Meléndez con las conexiones rotas por el sismo, el olor es fuerte en toda la manzana, pedimos evacuación preventiva y cierre de llaves maestras",
     "lat": 3.3890, "lng": -76.5480, "barrio": "Meléndez", "urgencia_manual": 3},

    {"testimonio": "[DEMO] El puente vehicular del Callejón Guaduales sobre la quebrada tiene grietas visibles en los estribos, está siendo usado como vía alterna por el bloqueo de la Calle 5, hay riesgo real de colapso",
     "lat": 3.4250, "lng": -76.5450, "barrio": "Guaduales", "urgencia_manual": 2},

    {"testimonio": "[DEMO] Ingenieros de la Curaduría confirmamos riesgo de colapso progresivo en cuatro edificios del corredor Calle 13 en Alameda, el movimiento de escombros puede afectar las estructuras vecinas, necesitamos demolición controlada",
     "lat": 3.4400, "lng": -76.5350, "barrio": "Alameda", "urgencia_manual": 3},

    {"testimonio": "[DEMO] La red de acueducto del norte tiene 47 roturas confirmadas por EMCALI, varios barrios llevan dos días sin agua potable, se están distribuyendo carrotanques en los puntos de acopio, la situación es crítica",
     "lat": 3.4800, "lng": -76.5100, "barrio": "Norte", "urgencia_manual": 2},
]

PUNTOS_FASE4 = [
    {"nombre": "Sede Defensa Civil Cali",       "tipo": "comando",  "lat": 3.4480, "lng": -76.5280,
     "direccion": "Calle 19 # 4-50",                    "horario": "24 Horas"},
    {"nombre": "Centro Comunitario La Floresta", "tipo": "acopio",   "lat": 3.4350, "lng": -76.5530,
     "direccion": "Cra. 16 # 24-10, La Floresta",        "horario": "08:00–18:00"},
    {"nombre": "Colegio Palermo",                "tipo": "albergue", "lat": 3.4580, "lng": -76.5320,
     "direccion": "Av. 4N # 41N-50",                     "horario": "24 Horas"},
    {"nombre": "Parroquia La Sagrada Familia",   "tipo": "acopio",   "lat": 3.3870, "lng": -76.5460,
     "direccion": "Cra. 20 # 4E-33, Meléndez",           "horario": "07:00–21:00"},
    {"nombre": "Sede Cruz Roja Colombiana",      "tipo": "hospital", "lat": 3.4620, "lng": -76.5250,
     "direccion": "Calle 45N # 2N-80",                   "horario": "24 Horas"},
]

# ---------------------------------------------------------------------------
# Fase 5 — Ago 18-21 · "Gas + réplica + normalización"
# 3 reportes finales + apertura lote EMCALI
# ---------------------------------------------------------------------------

INC_FASE5 = [
    {"testimonio": "[DEMO] Técnicos de gas identificamos 13 cilindros industriales inestables en una bodega del barrio Los Cámbulos, la zona tiene daños sísmicos graves, estamos evacuando el sector preventivamente, Bomberos en camino para retiro controlado",
     "lat": 3.4181, "lng": -76.5375, "barrio": "Los Cámbulos", "urgencia_manual": 3},

    {"testimonio": "[DEMO] Estoy en el albergue del Coliseo Norte, acabamos de sentir una réplica muy fuerte a las 20:38, gente salió corriendo hacia afuera, hay pánico general y algunos heridos leves por caídas, revisando si hay daños estructurales nuevos",
     "lat": 3.4450, "lng": -76.5300, "barrio": "Centro", "urgencia_manual": 2},

    {"testimonio": "[DEMO] Con la remoción del Edificio Vanessa finalizada, el corredor de la Calle 5 está despejado por primera vez en 11 días, el sistema MIO retoma operación normal desde las 16:00, los vecinos aplauden a los operarios",
     "lat": 3.4264, "lng": -76.5431, "barrio": "Calle 5", "urgencia_manual": 1},
]

PUNTOS_FASE5 = [
    {"nombre": "Lote EMCALI – La Base", "tipo": "comando", "lat": 3.4653, "lng": -76.4944,
     "direccion": "Carrera 8a con Calle 59", "horario": "06:00–23:59"},
]

# ---------------------------------------------------------------------------
# Definición de fases
# ---------------------------------------------------------------------------

# Puntos que reciben la primera ola de donaciones (Ago 11-13)
_DONACION_OLA1 = [
    "Ciudadela Petronio Álvarez",
    "Cancha de Hockey Miguel Calero",
    "Diamante de Béisbol",
    "Coliseo Metropolitano del Norte",
    "CIDES Parque Los Pinos",
    "Parroquia Juan Pablo II",
]

# Puntos que reciben la segunda ola (Ago 18-21) — más amplia, cubre todo el sistema
_DONACION_OLA2 = _DONACION_OLA1 + [
    "SENA Regional Cali Salomia",
    "Centro Comunitario Aguablanca",
    "Universidad San Buenaventura",
    "Colegio Berchmans",
    "Restaurante Lengua de Mariposa",
    "Centro Comunitario Siloé",
]

FASES = [
    {
        "num": 1, "label": "Ago 10 · 07:34 AM — Hora Cero: avalancha de reportes",
        "inc": INC_FASE1, "puntos": [], "inv": [], "cerrar_transitorios": False,
        "donaciones_destino": [], "donaciones_factor": 1.0,
    },
    {
        "num": 2, "label": "Ago 10 · 08:00 AM — Segunda ola + primeros puntos comunitarios",
        "inc": INC_FASE2, "puntos": PUNTOS_FASE2, "inv": INVENTARIO_FASE2, "cerrar_transitorios": False,
        "donaciones_destino": [], "donaciones_factor": 1.0,
    },
    {
        "num": 3, "label": "Ago 10 (tarde) — Infraestructura oficial del Estado",
        "inc": INC_FASE3, "puntos": PUNTOS_FASE3, "inv": INVENTARIO_FASE3, "cerrar_transitorios": False,
        "donaciones_destino": [], "donaciones_factor": 1.0,
    },
    {
        "num": 4, "label": "Ago 11-13 — Primera ola de donaciones nacionales",
        "inc": INC_FASE4, "puntos": PUNTOS_FASE4, "inv": [], "cerrar_transitorios": True,
        # factor 1.0: donaciones cubren exactamente las necesidades identificadas
        "donaciones_destino": _DONACION_OLA1, "donaciones_factor": 1.0,
    },
    {
        "num": 5, "label": "Ago 18-21 — Donaciones superan necesidades · Gas · Réplica · Normalización",
        "inc": INC_FASE5, "puntos": PUNTOS_FASE5, "inv": [], "cerrar_transitorios": False,
        # factor 1.5: solidaridad supera las necesidades — superávit en todos los puntos
        "donaciones_destino": _DONACION_OLA2, "donaciones_factor": 1.5,
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


def _crear_incidente_single(op_headers: dict, inc: dict) -> tuple:
    """Crea un incidente con su propio httpx.Client (no thread-safe compartido)."""
    with httpx.Client(timeout=90.0) as c:
        r = c.post(f"{API_BASE}/incidentes", json=inc, headers=op_headers, timeout=90.0)
        if r.status_code in (200, 201):
            return r.json(), inc
        return None, inc


def _crear_incidentes(op_headers: dict, incidentes: list, workers: int = INCIDENT_WORKERS) -> None:
    """Crea todos los incidentes en paralelo — cada hilo llama a Claude AI."""
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_crear_incidente_single, op_headers, inc): inc
            for inc in incidentes
        }
        for future in as_completed(futures):
            try:
                data, inc = future.result()
            except Exception as exc:
                print(f"     ERR incidente: {exc}")
                continue
            if data:
                print(
                    f"     OK  inc  {inc['barrio']:22}  urgencia={data.get('urgencia')}  "
                    f"tipo={str(data.get('tipo', ''))[:25]}"
                )
            else:
                print(f"     WARN inc {inc.get('barrio')}: fallo al crear")


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
            print(f"     OK  punto  {p['nombre']:40}  [{p['tipo']}]")
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


def _get_necesidades_incidentes(client: httpx.Client) -> dict:
    """
    GET /incidentes y agrega los recursos_solicitados de todos los incidentes [DEMO].
    Retorna {insumo_nombre: cantidad_total_estimada}.
    """
    r = client.get(f"{API_BASE}/incidentes", timeout=30.0)
    if r.status_code != 200:
        return {}
    necesidades: dict = {}
    for inc in r.json():
        if not inc.get("testimonio", "").startswith("[DEMO]"):
            continue
        for rec in inc.get("recursos_solicitados", []):
            nombre = (rec.get("insumo_nombre") or "").strip()
            cantidad = int(rec.get("cantidad_estimada") or 50)
            if nombre:
                necesidades[nombre] = necesidades.get(nombre, 0) + cantidad
    return necesidades


def _inyectar_donaciones(
    client: httpx.Client,
    op_h: dict,
    punto_ids: dict,
    puntos_destino: list,
    necesidades: dict,
    factor: float = 1.1,
    label: str = "",
) -> None:
    """
    Registra donaciones en puntos_destino para cubrir las necesidades de los incidentes.
    cantidad_actual = int(cantidad_necesaria * factor) — factor > 1.0 implica superávit.
    Usa POST /recursos/registrar que normaliza el nombre del insumo via SQL (sin IA).
    """
    if not necesidades:
        print("     Sin recursos_solicitados disponibles aún — saltando donaciones.")
        return

    activos = [n for n in puntos_destino if punto_ids.get(n)]
    if not activos:
        print("     WARN: ningún punto de destino disponible para donaciones.")
        return

    n_puntos = len(activos)
    ok = 0
    for punto_nombre in activos:
        pid = punto_ids[punto_nombre]
        for nombre, cantidad_total in necesidades.items():
            cant_necesaria = max(10, cantidad_total // n_puntos)
            cant_actual    = int(cant_necesaria * factor)
            payload = {
                "punto_id":         pid,
                "nombre_recurso":   nombre,
                "cantidad_actual":   cant_actual,
                "cantidad_necesaria": cant_necesaria,
            }
            r = client.post(
                f"{API_BASE}/recursos/registrar",
                json=payload,
                headers=op_h,
                timeout=30.0,
            )
            if r.status_code in (200, 201):
                ok += 1
            else:
                print(f"     WARN don. '{nombre}' → {punto_nombre}: {r.status_code} {r.text[:60]}")

    cobertura = "cubiertas" if factor >= 1.0 else "parciales"
    print(f"     {ok} donaciones {label}registradas en {n_puntos} punto(s) — necesidades {cobertura}")


def inyectar(db_conn) -> None:
    with db_conn.cursor() as cur:
        if ya_inyectado(cur):
            print("  i  Datos demo ya existen — omitiendo.")
            return

    t0 = time.time()

    with httpx.Client(timeout=30.0) as client:
        print("  -> Autenticando...")
        admin_h = login(client, "admin")
        op_h    = login(client, "operador")
        ente_id = get_ente_id(client, admin_h)
        insumos = get_insumos(client)
        punto_ids = dict(get_puntos_existentes(client))

        for fase in FASES:
            n     = fase["num"]
            total = len(FASES)
            print(f"\n  [{n}/{total}] {fase['label']}")

            if fase["inc"]:
                print(f"     Disparando {len(fase['inc'])} incidentes en paralelo ({INCIDENT_WORKERS} workers)...")
                _crear_incidentes(op_h, fase["inc"])

            if fase["puntos"]:
                _crear_puntos(client, admin_h, ente_id, punto_ids, fase["puntos"])

            if fase["inv"]:
                _cargar_inventario(client, admin_h, punto_ids, insumos, fase["inv"])

            if fase["cerrar_transitorios"]:
                _cerrar_transitorios(db_conn)

            if fase.get("donaciones_destino"):
                necesidades = _get_necesidades_incidentes(client)
                _inyectar_donaciones(
                    client, op_h, punto_ids,
                    fase["donaciones_destino"],
                    necesidades,
                    fase.get("donaciones_factor", 1.1),
                    label=f"ola {fase['num']} ",
                )

            if n < total:
                elapsed = time.time() - t0
                print(f"  ... {PHASE_DELAY}s → siguiente fase  [acumulado: {elapsed:.0f}s]")
                time.sleep(PHASE_DELAY)

    elapsed = time.time() - t0
    print(f"\n  OK Demo completo en {elapsed:.0f}s — terremoto Cali Ago 2026 inyectado.")
    print(f"     46 incidentes + 36 puntos de control en el mapa.")


# ---------------------------------------------------------------------------
# Main — polling hasta que aparece el primer incidente real
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
    print(f"OK Polling cada {POLL_INTERVAL}s — crea un incidente en la app para disparar el demo.")
    print(f"   PHASE_DELAY={PHASE_DELAY}s  INCIDENT_WORKERS={INCIDENT_WORKERS}")
    print("   (Ctrl+C para salir)\n")

    try:
        while True:
            time.sleep(POLL_INTERVAL)

            with conn.cursor() as cur:
                conteo_actual = contar_necesidades(cur)

            if conteo_actual > conteo_anterior:
                print(f"\nDetectado nuevo incidente ({conteo_anterior} → {conteo_actual}) — iniciando demo...")
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
