# PLAN MASTER DE OPTIMIZACIÓN Y DINAMIZACIÓN — PULSE (Platanus26SOGR)

> Documento de diagnóstico y planificación. **No contiene código de implementación aplicado**: describe qué cambiar, por qué, y en qué orden.
> Alcance auditado: `Backend/supabase/*.sql` (15 archivos), `Backend/src/backend/**` (capa API, dominio, infraestructura), `Backend/scripts/apply_supabase_migrations.py`.
> Fecha: 2026-08-22 · Rama: `main` · Commit base: `de60adf`

---

## 1. Resumen Ejecutivo y Diagnóstico General

### 1.1 Estado actual

PULSE es una API FastAPI con arquitectura hexagonal parcial (puertos/adaptadores implementados sólo para `User` y `PuntoControl`; el resto de endpoints hablan SQL crudo o ORM directamente) sobre PostgreSQL/Supabase con PostGIS, pgRouting y Realtime. La lógica de negocio está **repartida en tres capas simultáneas**:

| Capa | Dónde vive | Ejemplos |
|---|---|---|
| SQL / PLpgSQL | `Backend/supabase/*.sql` | `asignar_ayuda`, `voronoi_responsable`, `misiones_priorizadas`, `estado_ciudad`, `resolver_insumo` |
| Servicios de dominio Python | `domain/services/` | `InventarioService`, `LLMAnalysisService`, `SemanticDedupService` |
| Endpoints | `api/v1/endpoints/` | fusión geográfica de incidentes/nodos, merge de recursos, orquestación del agente |

Esa triple ubicación es la raíz de la mayoría de los problemas de rendimiento: hay **lógica geoespacial ejecutándose en Python sobre datos traídos completos desde Postgres**, mientras que PostGIS —ya instalado, ya indexado— podría resolverla en el motor.

### 1.2 Veredicto por dimensión

| Dimensión | Estado | Nota |
|---|---|---|
| Modelo de datos | 🟡 Aceptable | Normalización razonable; tipos correctos en general; `recursos_solicitados` como TEXT en vez de `jsonb` es la peor decisión de tipo |
| Indexación | 🔴 Deficiente | 6 índices en todo el esquema; **prácticamente ninguna FK está indexada**; dos de los seis índices existentes son inútiles (`lat,lng` btree) |
| Migraciones | 🔴 Crítico | Dos archivos SQL **no están registrados en el runner** → funciones que la API invoca en producción no existen |
| Patrones de query | 🔴 Deficiente | `SELECT *` sin filtro sobre tablas completas para cálculos que PostGIS haría por índice; N+1 en escritura de inventario; ausencia total de `LIMIT`/paginación |
| Capa de aplicación | 🔴 Crítico | Llamadas a LLM (2–10 s) **dentro de la transacción de DB**, con el pool de 5+10 conexiones retenido; el backend se llama a sí mismo por HTTP loopback |
| Concurrencia / async | 🟡 Parcial | Todo es `async` sintácticamente, pero las operaciones se serializan donde podrían paralelizarse (tools del agente, fallback de modelos LLM) |
| Caching | 🔴 Inexistente | Cero. Ni Redis, ni memoria, ni `Cache-Control`, ni ETag. Endpoints de altísima lectura y bajísima mutación se recalculan íntegros en cada request |
| Observabilidad | 🔴 Inexistente | Sin métricas, sin `slow query log`, sin tracing. Los `except Exception: pass` ocultan fallos reales |

### 1.3 El diagnóstico en una frase

> El sistema **no está limitado por la base de datos**: está limitado por *cuánto tiempo mantiene ocupada* la base de datos esperando a servicios externos, y por *cuántos datos mueve* desde Postgres a Python para hacer allí lo que Postgres ya sabe hacer.

Con el volumen actual (decenas de filas, demo de hackathon) nada de esto se manifiesta. Con **~50 usuarios concurrentes o ~10.000 filas** en `necesidades`/`nodos_afectados`/`inventario`, los puntos 2.1 a 2.5 producen caídas duras, no degradación suave.

---

## 2. Mapa de Riesgos y Cuellos de Botella Críticos

Ranking por impacto real (probabilidad × severidad × alcance).

---

### 🔴 R-01 — Migraciones huérfanas: funciones invocadas que no existen en la base

**Archivo:** `Backend/scripts/apply_supabase_migrations.py:41-53`

La lista `MIGRATIONS` enumera 13 archivos. En `Backend/supabase/` hay **15**. Faltan:

- `sinonimos_insumos.sql` → define la tabla `sinonimos_insumos`, `resolver_insumo()` y `registrar_con_normalizacion()`
- `catalogo_insumos_ia.sql` → define la vista materializada `catalogo_insumos_ia`

**Consecuencia directa** (no hipotética):

| Consumidor | Qué invoca | Resultado en una BD recién migrada |
|---|---|---|
| `endpoints/recursos.py:38` (`GET /recursos/consultar`) | `resolver_insumo()` | `UndefinedFunction` → 500 |
| `endpoints/recursos.py:76` (`POST /recursos/registrar`) | `registrar_con_normalizacion()` | `UndefinedFunction` → 500 |
| `agente.py:188` (tool `consultar_recurso`) | el endpoint anterior | tool siempre en error → el agente alucina o se disculpa |
| `semantic_dedup_service.py:96` (fallback 1) | `resolver_insumo()` | silenciado por `except`, degrada a heurística de strings |
| `endpoints/insumos.py:88` | `REFRESH MATERIALIZED VIEW ... catalogo_insumos_ia` | silenciado por `except: pass` |

Es un problema de **corrección**, no de rendimiento, pero encabeza el ranking porque invalida una funcionalidad completa (normalización de insumos, una de las features de IA del producto) de forma invisible: todos los caminos de fallo están envueltos en `try/except` silenciosos.

---

### 🔴 R-02 — Llamadas a LLM dentro de la transacción de base de datos

**Archivos:** `endpoints/incidentes.py:44-112`, `endpoints/insumos.py:39-88`

```
create_incidente(payload, current_user, db)   ← `db` se inyecta y CHECKOUT del pool ocurre aquí
  ├─ SELECT nombre,categoria,unidad FROM insumos       (~1 ms)
  ├─ await LLMAnalysisService().analyze_incident_testimony(...)   ← 2.000–10.000 ms
  ├─ SELECT * FROM necesidades WHERE estado IN (...)   (scan completo)
  ├─ INSERT / UPDATE / DELETE
  └─ commit                                            ← conexión devuelta al pool AQUÍ
```

La conexión permanece reservada durante toda la llamada al modelo. Con `DB_POOL_SIZE=5` + `DB_MAX_OVERFLOW=10` = **15 conexiones máximas**, bastan **15 reportes de campo simultáneos** para agotar el pool por completo y bloquear *toda* la API —incluido `/health`— hasta que el LLM responda.

`create_insumo` es peor todavía: `SemanticDedupService` reintenta hasta **3 modelos en secuencia** (`semantic_dedup_service.py:35-39`); un fallo de red en los dos primeros multiplica el tiempo de retención de la conexión.

Además, `LLMAnalysisService` y `SemanticDedupService` **construyen un `AsyncAnthropic` nuevo por request** (`llm_analysis_service.py:182`, `semantic_dedup_service.py:40`) — pool HTTP y handshake TLS desechados en cada llamada.

---

### 🔴 R-03 — Fusión geográfica ejecutada en Python sobre la tabla completa

**Archivos:** `endpoints/incidentes.py:79-86`, `endpoints/nodos_afectados.py:39-48`

```python
active_stmt = select(NecesidadModel).where(NecesidadModel.estado.in_(["pendiente","en_atencion"]))
active_incs = (await db.execute(active_stmt)).scalars().all()
nearby_incs = [inc for inc in active_incs
               if calculate_distance_meters(payload.lat, payload.lng, inc.lat, inc.lng) <= 100.0]
```

Cuatro problemas superpuestos:

1. **Trae la tabla entera de incidentes activos** en cada reporte. Y trae *todas las columnas*, incluidos `testimonio`, `analisis_ia` y `recursos_solicitados` (TEXT sin límite) — que ni siquiera se usan en el filtro de distancia. Cientos de KB por request desperdiciados.
2. **Haversine en Python** (`domain/utils/geo.py`) en vez de `ST_DWithin(geom::geography, ..., 100)`, que usaría el índice GiST ya existente. Coste O(N) lineal creciente contra O(log N).
3. `necesidades.estado` **no tiene índice** → *sequential scan* garantizado.
4. `nodos_afectados` tiene columna `geom` poblada por trigger pero **sin índice GiST** (`nodos_afectados.sql` lo omite explícitamente: *"sin funciones nuevas ni indices por ahora"*), así que ni siquiera la reescritura a PostGIS funcionaría bien sin añadirlo primero.

Este es el path más caliente del sistema (cada reporte de operador de campo lo atraviesa) y el que peor escala.

---

### 🔴 R-04 — `REFRESH MATERIALIZED VIEW CONCURRENTLY` dentro de un trigger

**Archivo:** `Backend/supabase/catalogo_insumos_ia.sql:12-23`

```sql
CREATE FUNCTION refresh_catalogo_insumos_ia() RETURNS trigger AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY catalogo_insumos_ia;
  ...
CREATE TRIGGER trg_refresh_catalogo_insumos_ia
AFTER INSERT OR UPDATE OR DELETE ON insumos FOR EACH STATEMENT ...
```

`REFRESH MATERIALIZED VIEW CONCURRENTLY` **no puede ejecutarse dentro de un bloque de transacción**, y un trigger siempre lo está. Postgres aborta con `REFRESH MATERIALIZED VIEW CONCURRENTLY cannot be executed from a function`. Es decir: **si esta migración estuviera aplicada, todo `INSERT` en `insumos` fallaría**. Que hoy no falle es consecuencia directa de R-01 (la migración nunca se aplica).

Si se corrige R-01 sin corregir esto, se rompe `POST /insumos` y `registrar_con_normalizacion()`. **Estos dos hallazgos deben resolverse en el mismo cambio.**

Además, refrescar la vista materializada completa en cada fila insertada es un patrón de coste desproporcionado: la vista es `SELECT id,nombre,categoria,unidad,criticidad FROM insumos ORDER BY ...` — una proyección trivial sobre una tabla de ~12 filas. **La vista materializada no aporta nada y debería eliminarse**; un índice ordinario cubre el mismo caso.

---

### 🔴 R-05 — Ausencia de índices en claves foráneas y columnas de filtro

Sólo existen **6 índices** en todo el esquema, y dos son inútiles.

**Existentes:**

| Índice | Veredicto |
|---|---|
| `idx_puntos_control_geom` (GiST) | ✅ Correcto y usado |
| `idx_necesidades_geom` (GiST) | ✅ Correcto (aunque hoy el código no lo aprovecha, ver R-03) |
| `idx_comunas_geom` (GiST) | ✅ Correcto |
| `idx_red_logistica_the_geom` (GiST) | 🟡 Nunca se consulta espacialmente; `ruta_optima` filtra por `source`/`target` |
| `idx_puntos_control_lat_lng` (btree) | ❌ **Muerto.** Ninguna query filtra por `(lat,lng)` en btree; todo va por `geom`. Sólo cuesta en escritura |
| `idx_necesidades_lat_lng` (btree) | ❌ **Muerto.** Ídem |

**Faltantes de mayor impacto** (detalle completo y DDL conceptual en §3.1):

- `inventario(insumo_id)` — FK sin índice. Presente en el **self-join de `misiones_priorizadas()`**, en `tool_inventario_nodo()`, en `asignar_ayuda()` y en el `ON DELETE CASCADE` de `insumos`. Es el índice de mayor retorno del esquema.
- `puntos_control(responsable_user_id)` — usado por `/puntos-control/mis-nodos`, por `alertas_nodos_inactivos(p_user_id)` y por `es_responsable_de_punto()`, que **RLS evalúa una vez por fila candidata**.
- `puntos_control(estado)` parcial `WHERE estado='activo'` — `voronoi_responsable`, `voronoi_celdas_ayuda`, `asignar_ayuda`, `inicializar_red_logistica` lo filtran todos.
- `necesidades(estado)` — R-03.
- `necesidades(urgencia DESC, creado_en DESC)` — `list_incidentes` ordena por ambas sin índice → *sort* en memoria de la tabla completa.
- `nodos_afectados` GiST sobre `geom` + parcial sobre `estado`.
- `insumos(lower(nombre))` — `resolver_insumo()` compara `lower(nombre) = ...`; sin índice funcional, seq scan.
- FKs sin índice: `necesidades(operador_id)`, `nodos_afectados(creado_por)`, `inventario(actualizado_por)`, `red_logistica(origen_id|destino_id)`.
- `audit_log(tabla, registro_id)` y `audit_log(timestamp DESC)` — la tabla que **más crece** del sistema no tiene un solo índice.

---

### 🟠 R-06 — `/ciudad/estado`: el endpoint más caro, sin caché, consumido por el agente

**Archivo:** `Backend/supabase/estado_ciudad.sql`

`estado_ciudad()` es un fan-out de cuatro subconsultas pesadas en una sola llamada:

```
estado_ciudad()
 ├─ agregado de puntos_control por estado            → seq scan
 ├─ misiones_priorizadas()   ← self-join de inventario_con_deficit  (ver R-07)
 ├─ alertas_nodos_inactivos() ← LEFT JOIN + GROUP BY + HAVING sobre todo el inventario
 └─ deficit_total  ← JOIN inventario_con_deficit × insumos + GROUP BY
```

Se recalcula íntegro **en cada petición**, sin `LIMIT` en ninguna rama, y es la primera tool que el agente de IA invoca (`agente.py:182`). Una sola consulta al agente puede dispararlo varias veces. Es el candidato #1 a caché con TTL corto.

---

### 🟠 R-07 — `misiones_priorizadas()`: self-join semi-cartesiano sin índices

**Archivos:** `pgrouting.sql:150`, redefinida en `rediseño_inventario.sql:95`

```sql
FROM inventario_con_deficit destino
JOIN inventario_con_deficit origen
  ON origen.insumo_id = destino.insumo_id
 AND origen.nivel = 'sobra'
 AND origen.punto_id <> destino.punto_id
WHERE destino.nivel IN ('no_hay','poco')
```

`inventario_con_deficit` es una vista sobre `inventario`. El join produce, por cada insumo, el **producto cartesiano** entre puntos con déficit y puntos con excedente. Con P puntos e I insumos el peor caso es O(P²·I). Sin índice en `inventario(insumo_id)` ni en `inventario(nivel)`, cada lado del join es un seq scan completo. **Sin `LIMIT`**: si hay 200 puntos y 12 insumos, devuelve decenas de miles de misiones al JSON de salida.

Agravante: la función está **definida dos veces** con cuerpos distintos (`pgrouting.sql` y `rediseño_inventario.sql`). Cuál queda activa depende del orden de migración. Fuente de verdad ambigua.

---

### 🟠 R-08 — Cascada Voronoi en el camino de escritura, vía trigger

**Archivos:** `nodos_afectados.sql:98` (`voronoi_responsable`), `nodos_afectados.sql:180` (`asignar_ayuda`), `plan_respuesta_nodo_afectado.sql:25` (trigger)

Cada `INSERT` en `nodos_afectados` dispara `AFTER INSERT → generar_plan_respuesta_nodo_afectado() → asignar_ayuda(new.id, 10.0)`, que a su vez:

1. Llama a `voronoi_responsable()` → `ST_VoronoiPolygons(ST_Collect(geom))` sobre **todos** los puntos activos, y luego un `JOIN ... ON ST_Contains(celda, pc.geom)` que compara cada celda contra cada punto: **O(n²) sin índice posible** (las celdas son transitorias, no indexables).
2. Entra en un bucle greedy: por cada iteración, un `SELECT` de nombre/distancia, un agregado sobre `inventario ⋈ insumos`, y una búsqueda del siguiente punto por `ST_DWithin` + `<->`.
3. Ejecuta un `UPDATE nodos_afectados` sobre su propia fila → que dispara `set_actualizado_en` y `geocodificar_nodos_afectados` **otra vez**.

Todo esto es tiempo de latencia que paga el operador de campo al reportar una emergencia. Y el mismo cálculo se repite íntegro en `GET /nodos-afectados/{id}/plan` y en `tool_plan_emergencia()`.

`voronoi_celdas_ayuda()` (endpoint `GET /puntos-control/voronoi`, que el mapa del frontend consume) recalcula el diagrama completo en cada carga de página. El comentario en el SQL lo justifica —*"recomputar el diagrama es barato"*— y es cierto con 6 puntos; deja de serlo con 200.

---

### 🟠 R-09 — El backend se llama a sí mismo por HTTP loopback

**Archivo:** `endpoints/agente.py:26,117-122`

```python
INTERNAL_API_BASE_URL = "http://127.0.0.1:8000/api/v1"   # hardcodeado

async def _get(path, params=None):
    async with httpx.AsyncClient(base_url=INTERNAL_API_BASE_URL, timeout=15.0) as client:
        ...
```

Problemas acumulados:

- **Cliente HTTP nuevo por cada tool call** → pool TCP creado y destruido cada vez.
- **URL hardcodeada** → se rompe en cualquier despliegue que no sea `localhost:8000` (contenedor, puerto distinto, múltiples workers). El comentario admite que se eliminó el setting correspondiente.
- **Cada tool call consume una conexión del pool de DB desde otro request**, mientras el request del agente sigue vivo. Amplificador directo de R-02.
- **Sin propagación de identidad**: las tools llaman a endpoints GET sin `Authorization`. Funciona porque `/ciudad/estado`, `/nodos-afectados`, `/puntos-control` **no exigen autenticación** — lo cual es a la vez el motivo por el que funciona y un hallazgo de seguridad: cualquiera lee el estado completo de la ciudad sin credenciales.
- **`_consultar_inventario_punto` (`agente.py:135`)** trae **todos** los puntos de control y filtra por substring en Python. Debería ser un `WHERE nombre ILIKE` en SQL.
- **Tools ejecutadas en serie** (`agente.py:223`): cuando el modelo pide 3 tools en un turno, se resuelven una tras otra en vez de con `asyncio.gather`. Latencia = suma, no máximo.

---

### 🟠 R-10 — N+1 en escritura de inventario y doble lectura en la respuesta

**Archivo:** `domain/services/inventario_service.py:117-147`

```python
for item in payload.items:
    existing_stmt = select(InventarioModel).where(punto_id==..., insumo_id==item.insumo_id)
    inv_row = (await self.session.execute(existing_stmt)).scalar_one_or_none()   # ← 1 query POR ÍTEM
    ...
await self.session.commit()
return await self.get_inventario_by_punto(punto_id)   # ← 3 queries más
```

Un `PUT` con 12 insumos = **12 SELECT + 12 INSERT/UPDATE + 3 SELECT** = 27 round-trips donde bastaría **1 `INSERT ... ON CONFLICT DO UPDATE` con `unnest`** + 1 `SELECT`. En Supabase, con latencia de red de ~20 ms por round-trip, son ~540 ms de puro ida-y-vuelta.

`get_inventario_by_punto` (líneas 48-90) además hace el producto catálogo × inventario **en Python** con un `dict` intermedio, cuando un `LEFT JOIN insumos ⟕ inventario` lo resuelve en una query.

Detalle a revisar aparte: las líneas 69-70 inventan valores por defecto (`50` y `100`) para insumos sin fila de inventario, presentándolos como stock real. Eso no es rendimiento, es corrección de datos, y contamina `deficit_total` en `estado_ciudad()`.

---

### 🟡 R-11 — Doble fuente de verdad del esquema, sin herramienta de migración

`main.py:32` ejecuta `init_db()` → `Base.metadata.create_all` en cada arranque, mientras `Backend/supabase/*.sql` define el mismo esquema con más detalle (CHECK constraints, defaults `gen_random_uuid()`, columnas `geom`, triggers).

Divergencias verificadas entre ORM y SQL:

| Elemento | En SQL | En el modelo ORM |
|---|---|---|
| `puntos_control.tipo` / `.estado` | `CHECK (... IN (...))` | `String` sin constraint |
| `puntos_control.geom` | `geometry(Point,4326)` | ausente |
| `nodos_afectados.geom`, `.nodos_ayuda_asignados`, `.plan_respuesta` | presentes | ausentes en `NodoAfectadoModel` |
| `inventario.nivel` | `CHECK (... IN (...))` | `String`, `default="bien"` |
| `necesidades.urgencia` | `CHECK (BETWEEN 1 AND 5)` | `Integer` sin constraint |

`create_all` no altera tablas existentes, así que hoy el SQL gana — pero en un entorno limpio donde el backend arranque *antes* de aplicar las migraciones (que es exactamente el orden que `schema.sql` documenta como requerido), las tablas se crean sin constraints ni geometría, y las migraciones posteriores con `CREATE TABLE IF NOT EXISTS` **no las corrigen**. No hay Alembic. No hay versionado de esquema.

---

### 🟡 R-12 — Configuración del pool y de la sesión

**Archivo:** `infrastructure/database.py:38-64`, `core/config.py:56-59`

| Parámetro | Valor | Observación |
|---|---|---|
| `pool_size=5, max_overflow=10` | 15 conexiones | Muy justo dado R-02; y si se corren N workers de uvicorn, se multiplica por N contra el límite de Supabase |
| `statement_cache_size=0` | Desactivado | Obligatorio en el *transaction pooler* (6543), pero **anula el caché de planes de asyncpg**: cada query se re-parsea y re-planifica. Si la conexión es directa o vía *session pooler* (5432), debe reactivarse |
| `statement_timeout=60000` | 60 s | Excesivo para una API interactiva. Un scan degenerado bloquea una conexión un minuto entero |
| `pool_pre_ping=True` | Activo | Añade un round-trip por checkout. Con `pool_recycle=300` (5 min) es redundante |
| `echo = DEBUG` con `DEBUG=True` por defecto | Activo | **Loguea cada sentencia SQL con sus parámetros** en el default de configuración. Coste de I/O real y fuga de datos en logs |
| `ssl.CERT_NONE`, `check_hostname=False` | Sin verificación | Hallazgo de seguridad: acepta cualquier certificado. Anula la protección TLS frente a MITM |

**`get_db` hace `commit()` en cada request** (`database.py:80-83`), incluidas las lecturas puras (`/health`, `/insumos`, `/puntos-control`) → un round-trip innecesario por GET. Y los endpoints que *ya* hacen `commit()` explícito acaban emitiendo un segundo commit sobre una transacción nueva y vacía.

---

### 🟡 R-13 — `app.current_user_id` se pierde antes de las escrituras auditadas

**Archivos:** `api/deps.py:29-40`, `schema.sql:96-134`

`set_db_current_user` ejecuta `set_config('app.current_user_id', :uid, true)` — el tercer parámetro `true` significa **`is_local`: válido sólo hasta el final de la transacción actual**. Se invoca en `get_current_user`, durante la resolución de dependencias. Cualquier `commit()` posterior (y los endpoints hacen varios) **cierra esa transacción y descarta la variable**.

Resultado: `trigger_audit()` lee `current_setting('app.current_user_id', true)` → vacío → **`audit_log.usuario_id` queda NULL** en la mayoría de las escrituras. La auditoría (RF-15) registra el *qué* pero pierde el *quién*. Lo mismo afecta a `app_current_user_role()` y `es_responsable_de_punto()` en las políticas RLS.

---

### 🟡 R-14 — Serialización triple de payloads JSON grandes

Patrón repetido en `ciudad.py:30`, `nodos_afectados.py:132`, `puntos_control.py:82`, `recursos.py:38`:

```python
raw_json = result.scalar_one()                      # 1. Postgres serializa a JSON (texto)
data = json.loads(raw_json)                         # 2. Python deserializa a dict
return SomeSchema.model_validate(data)              # 3. Pydantic valida y reconstruye
                                                    # 4. FastAPI re-serializa a JSON
```

Cuatro pasadas sobre el mismo payload. Para `/ciudad/estado` y `/puntos-control/voronoi` —los dos más voluminosos— el coste de CPU es medible y **bloquea el event loop** (`json.loads` y la validación Pydantic son síncronos y no ceden control). Con payloads grandes, esto degrada la latencia de *todas* las peticiones concurrentes, no sólo la propia.

---

### 🟡 R-15 — Ausencia total de paginación y de `LIMIT`

| Endpoint / función | Devuelve |
|---|---|
| `GET /incidentes` | Toda la tabla `necesidades`, con `testimonio` + `analisis_ia` + `recursos_solicitados` completos, parseando JSON por fila |
| `GET /puntos-control` | Toda la tabla |
| `GET /nodos-afectados` (`tool_triage_activo`) | Todos los nodos activos |
| `GET /users` | Todos los usuarios |
| `GET /insumos` | Todo el catálogo |
| `misiones_priorizadas()` | Todos los pares origen×destino |
| `puntos_cercanos()` / `necesidades_en_zona()` | Todo lo que caiga en el radio |

Ninguno acepta `limit`/`offset`/`cursor`. Ninguno declara un tope. Todos crecen sin límite con los datos.

---

### 🟡 R-16 — Realtime habilitado pero no utilizado

`realtime.sql` publica `inventario`, `necesidades` y `puntos_control` por CDC/replicación lógica — con el coste de WAL y replicación que eso implica. El frontend (`Frontend/lib/api.ts`) consume **exclusivamente por `fetch`**: no hay ni un suscriptor de `postgres_changes`. Se está pagando la infraestructura de tiempo real sin obtener el beneficio, y a la vez se recarga la API con polling manual.

---

### 🟢 R-17 — Hallazgos menores

- `resolver_insumo()` (`sinonimos_insumos.sql:44`): la rama (c) usa `ILIKE '%'||x||'%'` con `LIMIT 1` **sin `ORDER BY`** → seq scan *y* resultado no determinista entre ejecuciones.
- `recursos_solicitados` es `TEXT` con JSON serializado (`necesidad.py:26`) → imposible de indexar (GIN), imposible de agregar en SQL, obliga a `json.loads` por fila en Python. Debería ser `jsonb`.
- `audit_log` escribe **dos jsonb completos** (OLD y NEW) por cada UPDATE de inventario. Sin particionado ni política de retención: crecimiento no acotado en la tabla más escrita.
- `ruta_optima()` (`pgrouting.sql:69`): traduce UUID→nodo con dos `UNION ALL` sobre `red_logistica` completa, sin índice en `origen_id`/`destino_id`.
- `inicializar_red_logistica()` corre en el **lifespan de arranque** (`main.py:33`): `TRUNCATE` + inserción de los ~n²/2 pares + `pgr_createTopology`, en cada arranque de proceso — y con `reload=True` (el default de `DEBUG`), en cada recarga de código. Nunca se re-ejecuta cuando los puntos cambian, así que el grafo queda obsoleto sin aviso.
- `ElevenLabsSTTService()` se instancia por request (`incidentes.py:386,411`); `await file.read()` carga el audio completo en memoria sin límite de tamaño.
- Los `except Exception: pass` de `insumos.py:90`, `alertas.py:47` y `deps.py:38` ocultan fallos operativos reales. Sin logging, sin métrica, sin alerta.

---

## 3. Estrategia de Optimización SQL e Índices

### 3.1 Índices propuestos

Nueva migración `Backend/supabase/indices_optimizacion.sql`, idempotente (`IF NOT EXISTS`), a ejecutar con `CONCURRENTLY` en producción.

#### Prioridad 1 — impacto inmediato

| # | Índice (conceptual) | Resuelve |
|---|---|---|
| 1 | `inventario(insumo_id)` | Self-join de `misiones_priorizadas`, `tool_inventario_nodo`, `asignar_ayuda`, CASCADE de `insumos` |
| 2 | `inventario(punto_id, actualizado_en DESC)` | `alertas_nodos_inactivos` (reescrita con LATERAL, §3.2) |
| 3 | `puntos_control(responsable_user_id) WHERE responsable_user_id IS NOT NULL` | `/mis-nodos`, alertas por ente, `es_responsable_de_punto` en RLS |
| 4 | `puntos_control(estado) WHERE estado='activo'` (parcial) | Voronoi, cascada greedy, red logística |
| 5 | `necesidades(estado) WHERE estado IN ('pendiente','en_atencion')` (parcial) | Fusión de incidentes (R-03) |
| 6 | `necesidades(urgencia DESC, creado_en DESC)` | `GET /incidentes` sin sort en memoria |
| 7 | GiST sobre `nodos_afectados(geom)` | Prerrequisito de la reescritura de fusión (§3.2) |
| 8 | `nodos_afectados(estado) WHERE estado='activo'` (parcial) | `tool_triage_activo`, fusión |

#### Prioridad 2 — FKs y catálogo

| # | Índice | Resuelve |
|---|---|---|
| 9 | `insumos(lower(nombre))` (funcional) | `resolver_insumo` ramas (a) y (c) |
| 10 | GIN `insumos USING gin(nombre gin_trgm_ops)` + extensión `pg_trgm` | `ILIKE '%…%'` de `resolver_insumo` y de la búsqueda por nombre del agente |
| 11 | `necesidades(operador_id)` | FK sin índice |
| 12 | `nodos_afectados(creado_por)` | FK sin índice |
| 13 | `inventario(actualizado_por)` | FK sin índice |
| 14 | `red_logistica(source)`, `(target)`, `(origen_id)`, `(destino_id)` | `pgr_dijkstra` y `ruta_optima` |
| 15 | `audit_log(tabla, registro_id)` y `audit_log(timestamp DESC)` | Consultas de auditoría; hoy sin ningún índice |
| 16 | `inventario(nivel) WHERE nivel IN ('no_hay','poco','sobra')` (parcial) | Ambos lados del self-join de misiones |

#### Índices a eliminar

| Índice | Motivo |
|---|---|
| `idx_puntos_control_lat_lng` | Ninguna query lo puede usar (todo el filtrado geográfico va por `geom`/GiST). Sólo penaliza escrituras |
| `idx_necesidades_lat_lng` | Ídem |
| `idx_red_logistica_the_geom` | Evaluar: `the_geom` nunca se consulta espacialmente, sólo se lee para `ST_MakeLine` |

> **Validación obligatoria antes de aplicar:** correr `EXPLAIN (ANALYZE, BUFFERS)` sobre las queries afectadas *antes* y *después*, y consultar `pg_stat_user_indexes` tras 24 h para confirmar `idx_scan > 0`. Un índice sin uso es coste de escritura puro.

### 3.2 Reescrituras conceptuales de queries críticas

#### A. Fusión geográfica → PostGIS (elimina R-03)

**Antes:** traer todas las filas activas + Haversine en Python.
**Después:** una única query que devuelve *sólo* los candidatos dentro de 100 m, ya ordenados por distancia, proyectando únicamente las columnas necesarias para la fusión.

```
SELECT id, lat, lng, urgencia, prioridad_sugerida, recursos_solicitados, testimonio
FROM necesidades
WHERE estado IN ('pendiente','en_atencion')
  AND ST_DWithin(geom::geography, ST_MakePoint(:lng,:lat)::geography, 100)
ORDER BY geom::geography <-> ST_MakePoint(:lng,:lat)::geography
LIMIT 20
```

Efecto: de O(N) filas transferidas + O(N) cálculos en Python → O(log N) por índice GiST, con transferencia acotada. **Requiere el índice GiST en `nodos_afectados` (Prioridad 1, #7)** para el caso simétrico de `create_nodo_afectado`.

Alternativa a evaluar: encapsular fusión + merge en una función PLpgSQL `fusionar_incidente(...)` que haga todo en una transacción del servidor, eliminando el ciclo de round-trips de lectura-modificación-escritura.

#### B. `misiones_priorizadas()` — acotar el semi-cartesiano (R-07)

- Materializar los dos lados del join en CTEs previamente filtradas (`origen` sólo `nivel='sobra'`, `destino` sólo `nivel IN ('no_hay','poco')`) para que el planificador reduzca la cardinalidad antes del join, no después.
- Añadir un parámetro `p_limit int DEFAULT 50` y un `ORDER BY urgencia DESC LIMIT p_limit`. Consumidor real (`estado_ciudad`, agente IA) nunca necesita más de 20-50 misiones.
- Considerar `DISTINCT ON (destino.punto_id, destino.insumo_id)` para quedarse con el mejor origen por par destino-insumo en vez de emitir todas las combinaciones.
- **Eliminar la definición duplicada** de `pgrouting.sql` dejando `rediseño_inventario.sql` como única fuente de verdad.

#### C. `alertas_nodos_inactivos()` — de GROUP BY global a LATERAL (R-06)

**Antes:** `LEFT JOIN inventario` + `GROUP BY` de 6 columnas + `HAVING` → agrega todo el inventario para descartar la mayoría.
**Después:** iterar sólo los puntos activos y, por cada uno, un `LATERAL (SELECT max(actualizado_en) ...)` que con el índice `inventario(punto_id, actualizado_en DESC)` resuelve por *index-only scan* de una fila. El filtro temporal pasa al `WHERE` externo.

#### D. `voronoi_responsable()` / `asignar_ayuda()` — cachear el diagrama (R-08)

Tres opciones, de menor a mayor esfuerzo:

1. **Corto plazo:** en `voronoi_responsable`, saltarse el diagrama de Voronoi por completo. Por definición matemática, la celda que contiene un punto es la del **generador más cercano** — un `ORDER BY geom <-> target LIMIT 1` con índice GiST da *exactamente el mismo resultado* que construir el diagrama y hacer `ST_Contains`, en O(log n) en vez de O(n²). El fallback actual del código ya hace precisamente esto; **la rama del Voronoi es matemáticamente redundante y puede eliminarse.** Es la optimización de mejor relación impacto/riesgo del documento.
2. **Medio plazo:** para `voronoi_celdas_ayuda()` (que sí necesita las geometrías para dibujar el mapa), materializar las celdas en una tabla `voronoi_celdas_cache(punto_id, celda, generado_en)` con índice GiST, refrescada por trigger sobre `puntos_control` (INSERT/UPDATE de `estado` o `geom`) o por job. La mutación de puntos de control es rarísima comparada con las lecturas del mapa.
3. **Largo plazo:** sacar la generación del plan de respuesta del trigger `AFTER INSERT` y moverla a un job asíncrono (§4.3), devolviendo el nodo creado inmediatamente con `plan_respuesta = NULL` y `estado_plan = 'generando'`.

#### E. Upsert batch de inventario (R-10)

Sustituir el bucle de N SELECT + N escrituras por un único statement:

```
INSERT INTO inventario (punto_id, insumo_id, cantidad_actual, cantidad_necesaria, actualizado_en, actualizado_por)
SELECT :punto_id, u.insumo_id, u.actual, u.necesaria, now(), :user_id
FROM unnest(:insumo_ids, :actuales, :necesarias) AS u(insumo_id, actual, necesaria)
ON CONFLICT (punto_id, insumo_id) DO UPDATE SET ...
RETURNING *
```

De 27 round-trips a 2. `nivel` se deriva solo por el trigger `calcular_nivel_inventario` — eliminando de paso la duplicación de la fórmula en `compute_nivel()` de Python (`inventario_service.py:24-33`), que es una tercera copia de la misma regla de negocio.

#### F. `get_inventario_by_punto` — un solo LEFT JOIN

Reemplazar las 3 queries + merge en Python por `SELECT ... FROM insumos i LEFT JOIN inventario inv ON inv.insumo_id=i.id AND inv.punto_id=:pid ORDER BY i.categoria, i.nombre`, o consumir directamente la vista `inventario_con_deficit`.

### 3.3 Cambios de esquema

| Cambio | Motivo | Riesgo |
|---|---|---|
| `necesidades.recursos_solicitados` TEXT → `jsonb` | Permite índice GIN, agregación en SQL, elimina `json.loads` por fila (R-17) | Bajo; migración con `USING ...::jsonb` |
| Eliminar la vista materializada `catalogo_insumos_ia` y su trigger | Aporta cero sobre 12 filas y **rompe todo INSERT en `insumos`** (R-04) | Ninguno |
| Añadir GiST en `nodos_afectados(geom)` | Prerrequisito de §3.2.A | Ninguno |
| Particionar `audit_log` por rango mensual sobre `timestamp` + política de retención | Tabla de mayor crecimiento, sin índices ni purga (R-17) | Medio; hacerlo cuando el volumen lo justifique |
| Constraints `CHECK` en el ORM para igualar el SQL, o abandonar `create_all` en favor de Alembic | Elimina la doble fuente de verdad (R-11) | Medio; ver Fase 5 |
| Índice único sobre `puntos_control(lower(nombre))` | `get_by_nombre` compara exacto pero la lógica del agente y del dedup es case-insensitive | Bajo; requiere verificar que no haya colisiones actuales |

**Explícitamente NO se recomienda ahora:** particionamiento de `necesidades`/`nodos_afectados`, denormalización de contadores, ni sharding. El volumen no lo justifica y añadiría complejidad operativa sin retorno medible.

---

## 4. Estrategia de Dinamización y Arquitectura del Backend

### 4.1 Capa de datos y pooling

| Acción | Detalle |
|---|---|
| **Sacar el LLM de la transacción** | Resolver el análisis LLM *antes* de adquirir la sesión de DB, o abrir la sesión sólo para la escritura. Patrón: dependencia `db` sustituida por un *factory* (`async_session_maker`) que el endpoint abre en el `async with` más estrecho posible alrededor de las operaciones de base de datos. Es el cambio de mayor impacto de todo el plan |
| **Cliente Anthropic singleton** | Un `AsyncAnthropic` por proceso, creado en el `lifespan`, reutilizando su pool HTTP. Ídem `httpx.AsyncClient` |
| **Revisar el pool** | Si la conexión no usa el *transaction pooler* de Supabase (6543), reactivar `statement_cache_size` (caché de planes de asyncpg). Bajar `statement_timeout` a 5–10 s. Dimensionar `pool_size` en función de `workers × pool_size ≤ límite de Supabase` |
| **Quitar el commit incondicional de `get_db`** | Separar `get_db_readonly` (sin commit) de `get_db` (commit al salir), y usar el primero en todos los GET |
| **Reparar `app.current_user_id`** | Setearlo con `SET LOCAL` al inicio de cada transacción de escritura —no en la resolución de dependencias—, o usar un `event.listens_for(Session, "after_begin")`. Restaura la trazabilidad de `audit_log` y hace evaluables las políticas RLS |
| **`DEBUG=False` por defecto** | Desactiva `echo=True` del engine. Que el default de configuración loguee cada sentencia SQL es un coste de I/O gratuito |
| **Verificación TLS real** | `check_hostname=True`, `verify_mode=CERT_REQUIRED` contra el CA bundle de Supabase |

### 4.2 Reducción de latencia por request

| Acción | Detalle |
|---|---|
| **Eliminar el HTTP loopback del agente** | Las tools deben invocar **funciones Python internas** (o directamente las funciones SQL) en vez de hacer `httpx.get("http://127.0.0.1:8000/...")`. Elimina el hardcode de URL, el handshake por llamada y la doble ocupación del pool (R-09) |
| **Paralelizar las tools del agente** | `asyncio.gather` sobre los `tool_use` de un mismo turno. Latencia = máximo, no suma |
| **Respuesta JSON directa** | Para `/ciudad/estado`, `/puntos-control/voronoi`, `/nodos-afectados/{id}/plan`: si la función SQL ya devuelve el JSON final, retornar `Response(content=raw, media_type="application/json")` y saltarse `json.loads` + Pydantic + re-serialización (R-14). Conservar la validación Pydantic sólo donde se transforme el payload, y documentar el schema con `response_model` + `response_class` para no perder el contrato OpenAPI |
| **Paginación por cursor** | `?limit=&cursor=` en `/incidentes`, `/nodos-afectados`, `/puntos-control`, `/users`, con tope duro por defecto (p. ej. 100). Cursor sobre `(urgencia, creado_en, id)` para orden estable |
| **Proyecciones ligeras** | `GET /incidentes` no debería devolver `testimonio` ni `analisis_ia` completos en el listado: campo `descripcion` truncado en la lista, texto completo sólo en el detalle `/incidentes/{id}` |
| **Compresión** | `GZipMiddleware` (`minimum_size=1000`). Los payloads GeoJSON de Voronoi comprimen muy bien |
| **Límite de tamaño en upload de audio** | Validar `content-length` antes de `file.read()`, o consumir por chunks |

### 4.3 Trabajo asíncrono / diferido

Candidatos claros a salir del camino síncrono de la request:

| Trabajo | Hoy | Propuesta |
|---|---|---|
| Generación del plan de respuesta (`asignar_ayuda`) | Trigger `AFTER INSERT` bloqueante | Job en background (`BackgroundTasks` como primer paso; cola real si crece). Devolver `estado_plan='generando'` y notificar por Realtime al completarse |
| Análisis LLM del testimonio | Bloquea el `POST /incidentes` durante segundos | Persistir el incidente inmediatamente con `analisis_ia=NULL`, analizar en background, publicar el resultado por Realtime. El operador de campo obtiene confirmación al instante |
| Dedup semántico de insumos | Bloquea `POST /insumos` (hasta 3 modelos en serie) | Verificación local/trigram primero (rápida, cubre el 90 %); LLM sólo cuando la heurística sea ambigua. Y probar modelos **en paralelo con `as_completed`**, no en serie |
| `inicializar_red_logistica` | En el lifespan de arranque, cada vez | Comando de gestión explícito + refresco por trigger cuando cambian los puntos activos. Fuera del arranque |
| Refresco de la caché de celdas Voronoi | N/A (se recalcula por request) | Job o trigger sobre `puntos_control` |

### 4.4 Estrategia de caching

Ratio lectura/escritura observado por endpoint:

| Endpoint / dato | Mutación | Lectura | Estrategia | TTL |
|---|---|---|---|---|
| `GET /insumos` (catálogo) | Muy baja (~12 filas, cambia raramente) | Muy alta (frontend, LLM context en cada `POST /incidentes`) | **Memoria del proceso** + invalidación en `POST /insumos` | ∞ con invalidación |
| `GET /puntos-control` | Baja | Muy alta (mapa, agente) | Redis o memoria + ETag | 60 s |
| `GET /puntos-control/voronoi` | Sólo cambia con puntos activos | Alta (cada carga del mapa) | Tabla materializada (§3.2.D) + `Cache-Control` | Invalidación por trigger |
| `GET /ciudad/estado` | N/A (agregado) | Alta (agente IA, dashboard) | **Redis, TTL corto** — el mayor retorno del sistema | 15–30 s |
| `GET /alertas/nodos-inactivos` | N/A (agregado) | Media | Redis | 60 s |
| `misiones_priorizadas()` | N/A | Media (vía `estado_ciudad`) | Cubierto por el caché de `/ciudad/estado` | — |
| `GET /nodos-afectados` (triage) | Media | Alta | Redis, TTL muy corto | 10 s |
| `resolver_insumo()` | Casi nula | Alta (agente, registro) | Memoria (`lru_cache` con invalidación en alta de insumo/sinónimo) | ∞ con invalidación |
| `GET /incidentes` | Alta | Alta | **No cachear.** Paginar y proyectar en su lugar | — |

**Implementación recomendada:** empezar por caché **en memoria de proceso** (`cachetools.TTLCache`) para catálogo y sinónimos —cero infraestructura nueva, retorno inmediato—; introducir Redis sólo cuando haya más de un worker/réplica, momento en el que la coherencia entre procesos deja de ser opcional.

**Transversal:** `ETag` + `If-None-Match` en todos los GET cacheables. Un `304 Not Modified` ahorra la serialización *y* el ancho de banda, y el frontend ya usa `fetch`, que lo respeta de forma nativa.

### 4.5 Modularidad y reusabilidad de queries

- **Consolidar la lógica de nivel de inventario**: hoy la fórmula `cantidad_actual/cantidad_necesaria → nivel` existe **tres veces** (trigger `calcular_nivel_inventario`, `compute_nivel()` en Python, y los defaults `50`/`100` de `get_inventario_by_punto`). Fuente única: el trigger. Python deja de calcularlo.
- **Completar el patrón de repositorio**: `Necesidad`, `NodoAfectado` e `Inventario` no tienen puerto ni adaptador; sus queries viven inline en los endpoints. Extraerlas a repositorios hace las queries testeables, reutilizables y evita que la misma consulta se reescriba en tres endpoints.
- **Parametrizar las funciones SQL**: añadir `p_limit`, `p_offset`, `p_estado` a `misiones_priorizadas`, `tool_triage_activo` y `puntos_cercanos` en vez de crear variantes. Funciones más dinámicas, sin coste de rendimiento.
- **Una sola definición por función**: resolver la duplicación de `misiones_priorizadas` y establecer la convención de que cada objeto SQL se define en exactamente un archivo.
- **Registrar TODAS las migraciones** en `apply_supabase_migrations.py` y añadir un test que falle si `set(glob('supabase/*.sql')) != set(MIGRATIONS)`. Un test de tres líneas que habría evitado R-01.

---

## 5. Hoja de Ruta de Implementación

Cinco fases secuenciales. Cada bloque siguiente está redactado para copiarse y pegarse tal cual como prompt en una sesión posterior. **Respetar el orden**: la Fase 2 depende de los índices de la Fase 1, y la Fase 3 asume que el esquema ya es correcto.

---

### 📋 PROMPT 1 — Correcciones críticas de esquema y migraciones

```
Contexto: sigo el documento docs/PLAN_MASTER_OPTIMIZACION.md de este repositorio.
Ejecuta la FASE 1: Correcciones críticas de esquema, migraciones e índices.
Léelo antes de empezar y no salgas del alcance de esta fase.

Tareas:

1. Registrar las migraciones huérfanas (riesgo R-01):
   - Añade `sinonimos_insumos.sql` y `catalogo_insumos_ia.sql` a la lista MIGRATIONS
     de Backend/scripts/apply_supabase_migrations.py, en las posiciones correctas según
     sus dependencias (sinonimos_insumos requiere schema.sql y rediseño_inventario.sql).
   - Actualiza el docstring del script con el orden real.
   - Añade un test en Backend/tests/ que falle si algún archivo .sql de Backend/supabase/
     no está en MIGRATIONS.

2. Eliminar la vista materializada catalogo_insumos_ia (riesgo R-04):
   - Su trigger ejecuta REFRESH MATERIALIZED VIEW CONCURRENTLY dentro de una función,
     lo cual Postgres prohíbe: rompería todo INSERT en `insumos` en cuanto se aplique.
   - Reescribe catalogo_insumos_ia.sql para hacer DROP del trigger, de la función y de
     la vista materializada, sustituyéndola por un índice ordinario
     insumos(criticidad DESC, nombre) que cubre el mismo caso de uso.
   - Elimina el bloque REFRESH MATERIALIZED VIEW de Backend/src/backend/api/v1/endpoints/insumos.py.

3. Crear Backend/supabase/indices_optimizacion.sql con los índices de la sección 3.1
   del plan (Prioridad 1 y Prioridad 2), todos con IF NOT EXISTS, y con los DROP INDEX
   de los índices muertos identificados. Regístralo en MIGRATIONS.

4. Añadir a esa misma migración el índice GiST sobre nodos_afectados(geom), que hoy no
   existe pese a que la columna se puebla por trigger.

Restricciones:
- Todo el SQL debe ser idempotente y re-ejecutable.
- No cambies lógica de negocio en esta fase.
- Al terminar, muéstrame un resumen de qué índices se crean, cuáles se eliminan y qué
  query concreta se beneficia de cada uno.
```

---

### 📋 PROMPT 2 — Reescritura de queries y eliminación de anti-patrones SQL

```
Contexto: sigo docs/PLAN_MASTER_OPTIMIZACION.md. La FASE 1 ya está aplicada
(migraciones registradas e índices creados).
Ejecuta la FASE 2: Reescritura de queries críticas. Sección 3.2 del plan.

Tareas:

1. Fusión geográfica en PostGIS (riesgo R-03) — el cambio de mayor impacto:
   - En endpoints/incidentes.py::create_incidente y endpoints/nodos_afectados.py::create_nodo_afectado,
     sustituye el patrón "traer todas las filas activas + Haversine en Python" por una
     única query con ST_DWithin(geom::geography, ..., 100) ordenada por distancia y con LIMIT.
   - Proyecta SOLO las columnas que la lógica de fusión necesita: hoy se traen testimonio,
     analisis_ia y recursos_solicitados completos sin usarlos en el filtro.
   - Los tests Backend/tests/test_nodos_afectados_fusion.py deben seguir pasando.
     OJO: corren sobre SQLite, que no tiene PostGIS — necesitarás mantener el camino Python
     como fallback por dialecto (mismo patrón que ya usa endpoints/alertas.py) o migrar
     esos tests a Postgres. Dime qué opción eliges y por qué antes de implementarla.

2. voronoi_responsable() (riesgo R-08):
   - La rama de ST_VoronoiPolygons + ST_Contains es matemáticamente redundante: la celda
     de Voronoi que contiene un punto es siempre la del generador más cercano, que es
     exactamente lo que ya hace el fallback (ORDER BY geom <-> target LIMIT 1) en O(log n)
     con índice GiST en vez de O(n²).
   - Simplifica la función a la búsqueda del vecino más cercano. Documenta en el comentario
     SQL por qué es equivalente. NO toques voronoi_celdas_ayuda(), que sí necesita las
     geometrías de las celdas para dibujar el mapa.

3. misiones_priorizadas() (riesgo R-07):
   - Elimina la definición duplicada de pgrouting.sql; deja rediseño_inventario.sql como
     única fuente de verdad, con una nota que apunte ahí.
   - Añade el parámetro p_limit int DEFAULT 50 con ORDER BY urgencia DESC LIMIT p_limit.
   - Reestructura el self-join con CTEs pre-filtradas para reducir cardinalidad antes del join.

4. alertas_nodos_inactivos() (riesgo R-06):
   - Reescribe el LEFT JOIN + GROUP BY + HAVING como un LATERAL que aproveche el índice
     inventario(punto_id, actualizado_en DESC) creado en la Fase 1.

5. Upsert batch de inventario (riesgo R-10):
   - En domain/services/inventario_service.py::update_inventario, sustituye el bucle de
     N SELECT + N escrituras por un único INSERT ... ON CONFLICT DO UPDATE con unnest.
   - En get_inventario_by_punto, sustituye las 3 queries + merge en Python por un LEFT JOIN.
   - Elimina compute_nivel() de Python: `nivel` lo deriva el trigger calcular_nivel_inventario.
   - Revisa aparte los valores por defecto 50/100 de las líneas 69-70: presentan stock
     inventado como si fuera real. Propón qué hacer, no lo cambies sin confirmarlo conmigo.

Al terminar: EXPLAIN ANALYZE del antes y el después de cada query tocada, y confirma que
la suite de tests pasa entera.
```

---

### 📋 PROMPT 3 — Capa de datos, pooling y desbloqueo del pool

```
Contexto: sigo docs/PLAN_MASTER_OPTIMIZACION.md. Fases 1 y 2 aplicadas.
Ejecuta la FASE 3: Optimización de la capa de datos y del ciclo de vida de conexiones.
Sección 4.1 del plan.

Tareas, por orden de impacto:

1. Sacar las llamadas al LLM fuera de la transacción de base de datos (riesgo R-02,
   el cuello de botella más severo del sistema):
   - Hoy endpoints/incidentes.py::create_incidente y endpoints/insumos.py::create_insumo
     reciben `db` por inyección de dependencias, lo que reserva una conexión del pool
     ANTES de una llamada a Anthropic de 2 a 10 segundos. Con pool_size=5 + max_overflow=10,
     15 reportes simultáneos bloquean toda la API.
   - Refactoriza para que la sesión de DB se abra en el ámbito más estrecho posible
     alrededor de las operaciones de base de datos, con el LLM resuelto fuera.
   - Mantén el contrato de la API (request/response) sin cambios.

2. Clientes HTTP reutilizables:
   - AsyncAnthropic se instancia por request en llm_analysis_service.py:182 y en
     semantic_dedup_service.py:40. Créalo una vez en el lifespan de main.py y reutilízalo.
   - Ídem httpx.AsyncClient en agente.py.

3. Configuración del engine (infrastructure/database.py y core/config.py):
   - Separa get_db (con commit) de get_db_readonly (sin commit) y usa el segundo en todos
     los endpoints GET: hoy cada lectura paga un commit inútil.
   - Baja statement_timeout de 60 s a un valor razonable para una API interactiva (5-10 s).
   - Cambia el default de DEBUG a False: hoy activa echo=True y loguea cada sentencia SQL
     con sus parámetros.
   - Corrige la configuración SSL: hoy usa check_hostname=False y CERT_NONE, lo que anula
     la protección TLS. Debe verificar contra el CA bundle.
   - Documenta en comentario cuándo statement_cache_size=0 es necesario (transaction pooler,
     puerto 6543) y cuándo puede reactivarse (conexión directa o session pooler, 5432).

4. Reparar app.current_user_id (riesgo R-13):
   - set_config(..., is_local=true) en api/deps.py::set_db_current_user se descarta en el
     primer commit, así que audit_log.usuario_id queda NULL en casi todas las escrituras.
   - Haz que la variable se establezca al inicio de cada transacción de escritura
     (event listener "after_begin" de SQLAlchemy, o SET LOCAL explícito en el bloque de escritura).
   - Añade un test que verifique que audit_log.usuario_id se puebla tras un UPDATE de inventario.

5. Elimina los `except Exception: pass` silenciosos de insumos.py, alertas.py y deps.py:
   sustitúyelos por logging con nivel apropiado. No cambies el comportamiento de fallback,
   sólo hazlo observable.

Al terminar: mide con una prueba de carga sencilla (p. ej. 20 POST /incidentes concurrentes)
el antes y el después de la latencia p95 y del agotamiento del pool.
```

---

### 📋 PROMPT 4 — Caching, paginación y payloads

```
Contexto: sigo docs/PLAN_MASTER_OPTIMIZACION.md. Fases 1-3 aplicadas.
Ejecuta la FASE 4: Estrategia de caching y reducción de payloads. Secciones 4.2 y 4.4.

Tareas:

1. Capa de caché en memoria de proceso (cachetools.TTLCache; sin Redis todavía —
   introdúcelo sólo si detectas que ya hay más de un worker configurado):
   - Catálogo de insumos: TTL infinito con invalidación explícita en POST /insumos.
   - GET /puntos-control: TTL 60 s.
   - GET /ciudad/estado: TTL 15-30 s. Es el endpoint más caro del sistema y la primera
     tool que invoca el agente de IA.
   - GET /alertas/nodos-inactivos: TTL 60 s. OJO: la respuesta depende del rol y del
     user_id del solicitante — la clave de caché debe incluirlos o habrá fuga entre entes.
   - resolver_insumo(): caché en memoria con invalidación al crear insumos o sinónimos.
   Diseña la clave de caché con cuidado en todo endpoint cuya respuesta dependa del usuario.

2. Paginación por cursor en GET /incidentes, GET /nodos-afectados, GET /puntos-control
   y GET /users:
   - Parámetros `limit` (default 50, máximo 200) y `cursor`.
   - Cursor estable sobre (urgencia, creado_en, id) donde aplique.
   - Mantén compatibilidad hacia atrás con el frontend: si no se pasa `limit`, aplica el
     default en vez de romper los consumidores actuales.

3. Proyecciones ligeras:
   - GET /incidentes no debe devolver testimonio ni analisis_ia completos en el listado.
     Trunca `descripcion` y deja el texto íntegro sólo en el detalle GET /incidentes/{id}.

4. Respuesta JSON directa (riesgo R-14):
   - En /ciudad/estado, /puntos-control/voronoi y /nodos-afectados/{id}/plan, la función
     SQL ya devuelve el JSON final y el código hace json.loads + Pydantic + re-serialización:
     cuatro pasadas sobre el mismo payload, bloqueando el event loop.
   - Devuelve Response(content=raw, media_type="application/json") conservando el
     response_model para que el contrato OpenAPI no se degrade.

5. GZipMiddleware con minimum_size=1000 en main.py.

6. ETag + If-None-Match en los GET cacheables. El frontend usa fetch, que lo respeta nativamente.

Verifica que el frontend en Frontend/lib/api.ts sigue funcionando con cada cambio de contrato.
```

---

### 📋 PROMPT 5 — Arquitectura: agente, trabajo asíncrono y gobernanza del esquema

```
Contexto: sigo docs/PLAN_MASTER_OPTIMIZACION.md. Fases 1-4 aplicadas.
Ejecuta la FASE 5: Refactorización arquitectónica. Secciones 4.2, 4.3 y 4.5.

Tareas:

1. Eliminar el HTTP loopback del agente (riesgo R-09) — endpoints/agente.py:
   - Las tools llaman a http://127.0.0.1:8000/api/v1 hardcodeado, creando un httpx.AsyncClient
     nuevo por llamada y consumiendo una segunda conexión del pool desde otro request.
     Además se rompe en cualquier despliegue que no sea localhost:8000.
   - Refactoriza _dispatch_tool para invocar las funciones internas (servicios o funciones SQL)
     directamente, sin pasar por HTTP.
   - Paraleliza con asyncio.gather los tool_use de un mismo turno: hoy se resuelven en serie.
   - _consultar_inventario_punto trae TODOS los puntos y filtra por substring en Python:
     hazlo con ILIKE en SQL, aprovechando el índice trigram de la Fase 1.
   - Señala (sin arreglarlo en esta fase, salvo que te lo confirme) que /ciudad/estado,
     /nodos-afectados y /puntos-control no exigen autenticación.

2. Sacar el trabajo pesado del camino síncrono (sección 4.3):
   - Análisis LLM del testimonio: persiste el incidente de inmediato con analisis_ia=NULL,
     analiza en background y publica el resultado. El operador de campo obtiene confirmación
     al instante en vez de esperar segundos.
   - Trigger generar_plan_respuesta_nodo_afectado: hoy corre asignar_ayuda() de forma
     bloqueante en el AFTER INSERT. Muévelo a un job en background con un campo de estado.
   - Dedup semántico: heurística local/trigram primero; LLM sólo si la heurística es ambigua.
     Y prueba los modelos en paralelo con as_completed, no en serie como ahora.
   - inicializar_red_logistica: sácalo del lifespan de arranque (hoy corre en cada recarga
     con reload=True) y conviértelo en un comando explícito.
   Empieza con BackgroundTasks de FastAPI; propón una cola real sólo si lo justificas.

3. Gobernanza del esquema (riesgo R-11):
   - Introduce Alembic y elimina Base.metadata.create_all del lifespan.
   - Genera una migración inicial que refleje el estado real actual de la base.
   - Alinea los modelos ORM con el SQL: faltan geom, nodos_ayuda_asignados y plan_respuesta
     en NodoAfectadoModel, y ningún CHECK constraint está replicado en el ORM.
   - Documenta la convención: el SQL de Backend/supabase/ es la fuente de verdad para
     funciones, triggers, RLS y geometría; Alembic para la estructura de tablas.

4. Completar el patrón de repositorio (sección 4.5):
   - Necesidad, NodoAfectado e Inventario no tienen puerto ni adaptador; sus queries viven
     inline en los endpoints. Extráelas siguiendo el patrón de PuntoControlRepository.

5. Migración de tipo: necesidades.recursos_solicitados de TEXT a jsonb, eliminando los
   json.loads/json.dumps por fila del código Python.

6. Observabilidad mínima: middleware que registre duración por endpoint, contador de
   checkouts del pool, y logging de queries por encima de un umbral configurable.
   Sin esto no hay forma de verificar que las fases 1-4 sirvieron de algo.
```

---

## 6. Resumen de impacto estimado

| Fase | Esfuerzo | Riesgo de regresión | Impacto esperado |
|---|---|---|---|
| 1 — Esquema e índices | Bajo | Muy bajo | **Restaura funcionalidad rota** (R-01, R-04) + base para todo lo demás |
| 2 — Reescritura de queries | Medio | Medio (tocar la fusión requiere cuidado con los tests) | Fusión de O(N) a O(log N); Voronoi de O(n²) a O(log n) |
| 3 — Capa de datos y pooling | Medio | Medio | **Elimina el agotamiento del pool**: de ~15 a cientos de escrituras concurrentes |
| 4 — Caching y payloads | Bajo-Medio | Bajo | Latencia de lectura reducida drásticamente en `/ciudad/estado` y `/puntos-control` |
| 5 — Arquitectura | Alto | Medio-Alto | Latencia percibida de escritura de segundos a milisegundos; despliegue reproducible |

**Si sólo hubiera tiempo para tres cosas:** Fase 1 completa (corrige funcionalidad rota y es casi gratis), la tarea 1 de la Fase 3 (sacar el LLM de la transacción — el único cuello de botella que produce caída total del servicio) y la tarea 1 de la Fase 2 (fusión en PostGIS — el path más caliente y el que peor escala).

---

*Documento generado por análisis estático del codebase. Las estimaciones de complejidad algorítmica se derivan de la lectura del código y del esquema; los tiempos absolutos requieren medición con `EXPLAIN ANALYZE` y pruebas de carga sobre datos de producción.*
