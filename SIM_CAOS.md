# sim_caos.py — Guía de uso

Genera emergencias caóticas en el mapa en tiempo real:
triángulos que aparecen, pasan a "en atención" y se resuelven solos,
con timing desordenado y múltiples casos simultáneos.
Al terminar borra todo lo que creó — el mapa queda limpio.

---

## Requisitos previos

Asegúrate de tener corriendo **antes** de lanzar la sim:

| Terminal | Comando |
|---|---|
| Backend | `cd Backend && uv run uvicorn backend.main:app --reload` |
| Celery  | `cd Backend && uv run celery -A backend.collaboration.tasks.celery_app worker --loglevel=info` |
| Redis   | `docker compose up -d` (ya corre como contenedor) |
| Frontend | `cd Frontend && npm run dev` |

Verifica que el backend responde: <http://localhost:8000/docs>

---

## Paso 1 — Limpiar la BD y sembrar hospitales

```bash
cd Backend
$env:DATABASE_URL = "postgresql+asyncpg://postgres.miefwkpfogifjujlmwue:4E3VSkVlM9lf4tK7@aws-0-us-east-2.pooler.supabase.com:6543/postgres"
echo "s" | uv run python scripts/clean_all.py
```

Esto borra todos los datos operativos y deja los 5 hospitales/bancos
de sangre que existían antes del terremoto.

> Solo es necesario al inicio de cada demo — si ya tienes la BD limpia, sáltate este paso.

---

## Paso 2 — Lanzar la simulación caótica

```bash
cd Backend
uv run python scripts/sim_caos.py
```

### Con opciones personalizadas

```bash
uv run python scripts/sim_caos.py --oleadas 4 --por-oleada 5 --delay-min 5 --delay-max 60
```

| Parámetro | Default | Descripción |
|---|---|---|
| `--oleadas` | `3` | Número de oleadas de casos |
| `--por-oleada` | `4` | Casos por oleada |
| `--delay-min` | `5` | Segundos mínimos en atención antes de resolver |
| `--delay-max` | `20` | Segundos máximos en atención antes de resolver |
| `--entre-oleadas` | `4.0` | Segundos entre el lanzamiento de cada oleada |
| `--sin-setup` | — | Saltar la fase 0 si los acopios ya existen |

---

## Qué verás en el mapa

1. **Fase 0** (~10s): aparecen 6 puntos de acopio/albergue/comando en Cali
2. **Oleadas solapadas**: triángulos rojos pulsantes aparecen en distintos barrios
3. Cada triángulo pasa de **pendiente → en atención** en segundos
4. Después de un tiempo aleatorio → **resuelto** → el triángulo desaparece
5. Varios casos activos al mismo tiempo con distinto ritmo de resolución
6. **Al terminar**: todo lo creado por la sim se borra automáticamente

---

## Recomendación para la demo

```bash
uv run python scripts/sim_caos.py --oleadas 4 --por-oleada 5 --delay-min 8 --delay-max 45 --entre-oleadas 5
```

20 incidentes en 4 oleadas, con casos activos durante ~45s máximo.
Duración total visible en el mapa: ~2 minutos de caos.

---

## Cuentas demo

| Rol | Email | Password |
|---|---|---|
| Administrador | `admin@sogr.gov.co` | `admin123` |
| Ente territorial | `ente.alcaldia@sogr.gov.co` | `ente123` |
| Operador de campo | `operador@sogr.gov.co` | `operador123` |
