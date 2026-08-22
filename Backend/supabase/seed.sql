-- ============================================================
-- SOGR - Datos de siembra para demo (Sprint 1, tarea 5)
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql y postgis.sql ya aplicados (el trigger de
-- postgis.sql llena "geom" solo al insertar en puntos_control).
--
-- Idempotencia: puntos_control e insumos no tenian ninguna columna
-- unica ademas de "id" (que es random en cada insert), asi que
-- "ON CONFLICT DO NOTHING" no tenia nada contra que chocar. Agrego
-- una constraint UNIQUE(nombre) en ambas tablas (con guard para no
-- fallar si ya existe) para que el conflicto sea real y el seed se
-- pueda correr mas de una vez sin duplicar filas. inventario ya
-- tiene PK compuesta (punto_id, insumo_id), esa no necesita cambios.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'puntos_control_nombre_key') then
    alter table puntos_control add constraint puntos_control_nombre_key unique (nombre);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'insumos_nombre_key') then
    alter table insumos add constraint insumos_nombre_key unique (nombre);
  end if;
end;
$$;

-- ============================================================
-- 1. Puntos de acopio reales (Cali)
-- ============================================================

insert into puntos_control (nombre, tipo, estado, lat, lng, verificado)
values
  ('Plazoleta Jairo Varela',      'acopio', 'activo', 3.4516, -76.5320, true),
  ('Banco de Alimentos de Cali',  'acopio', 'activo', 3.4372, -76.5225, true),
  ('Cruz Roja Seccional Valle',   'acopio', 'activo', 3.4445, -76.5198, true)
on conflict (nombre) do nothing;

-- ============================================================
-- 2. Albergues ficticios de demo (prefijo "DEMO —" para que nunca
-- se confundan con datos reales en el mapa). verificado=false
-- porque, a diferencia de los puntos de arriba, no son sitios
-- reales verificados por el ente publico.
-- ============================================================

insert into puntos_control (nombre, tipo, estado, lat, lng, verificado)
values
  ('DEMO — Albergue Comuna 13', 'albergue', 'activo', 3.4180, -76.5050, false),
  ('DEMO — Albergue Comuna 18', 'albergue', 'activo', 3.3950, -76.5400, false),
  ('DEMO — Albergue Comuna 20', 'albergue', 'activo', 3.4650, -76.5600, false)
on conflict (nombre) do nothing;

-- ============================================================
-- 3. Catalogo de insumos
-- ============================================================

insert into insumos (nombre, categoria, unidad, criticidad)
values
  ('agua',                       'agua',      'litros',   5),
  ('suero oral',                 'salud',     'sobres',   5),
  ('comida preparada',           'alimentos', 'raciones', 4),
  ('alimentos no perecederos',   'alimentos', 'kg',       4),
  ('medicamentos básicos',       'salud',     'unidades', 4),
  ('colchonetas',                'abrigo',    'unidades', 3),
  ('cobijas',                    'abrigo',    'unidades', 3),
  ('kits de aseo',               'aseo',      'kits',     2),
  ('guantes de construcción',    'seguridad', 'pares',    2),
  ('pañales',                    'bebe',      'paquetes', 3),
  ('ropa',                       'abrigo',    'unidades', 1),
  ('comida para mascotas',       'mascotas',  'kg',       1)
on conflict (nombre) do nothing;

-- ============================================================
-- 4. Inventario inicial con desbalances para la demo.
--
-- "Banco de Alimentos: alimentos=bien" lo mapeo a "alimentos no
-- perecederos" del catalogo (no hay un insumo llamado solo
-- "alimentos"; un banco de alimentos maneja sobre todo no
-- perecederos, tiene sentido de dominio).
--
-- horas_atras fija actualizado_en en el pasado SOLO para que
-- misiones_priorizadas() tenga variacion real de horas_faltando
-- al momento de sembrar (si no, todas las filas nacerian con
-- actualizado_en = now() y el termino de horas del calculo de
-- urgencia daria ~0 para todas). En 'sobra'/'bien' no importa
-- porque la formula de urgencia no usa el actualizado_en del
-- origen, solo el del destino con faltante.
-- ============================================================

insert into inventario (punto_id, insumo_id, nivel, actualizado_en)
select pc.id, i.id, v.nivel, now() - (v.horas_atras || ' hours')::interval
from (values
  ('Plazoleta Jairo Varela', 'agua', 'sobra', 0),
  ('Plazoleta Jairo Varela', 'colchonetas', 'sobra', 0),
  ('Plazoleta Jairo Varela', 'cobijas', 'no_hay', 10),
  ('Plazoleta Jairo Varela', 'kits de aseo', 'poco', 4),

  ('Banco de Alimentos de Cali', 'alimentos no perecederos', 'bien', 0),
  ('Banco de Alimentos de Cali', 'agua', 'poco', 3),
  ('Banco de Alimentos de Cali', 'pañales', 'no_hay', 12),

  ('Cruz Roja Seccional Valle', 'medicamentos básicos', 'bien', 0),
  ('Cruz Roja Seccional Valle', 'suero oral', 'sobra', 0),
  ('Cruz Roja Seccional Valle', 'guantes de construcción', 'no_hay', 7),

  ('DEMO — Albergue Comuna 20', 'agua', 'no_hay', 8),
  ('DEMO — Albergue Comuna 20', 'colchonetas', 'no_hay', 5),
  ('DEMO — Albergue Comuna 20', 'comida preparada', 'poco', 2),

  ('DEMO — Albergue Comuna 18', 'cobijas', 'no_hay', 9),
  ('DEMO — Albergue Comuna 18', 'ropa', 'poco', 2),

  ('DEMO — Albergue Comuna 13', 'agua', 'poco', 6),
  ('DEMO — Albergue Comuna 13', 'medicamentos básicos', 'no_hay', 1)
) as v(punto_nombre, insumo_nombre, nivel, horas_atras)
join puntos_control pc on pc.nombre = v.punto_nombre
join insumos i on i.nombre = v.insumo_nombre
on conflict (punto_id, insumo_id) do nothing;

-- ============================================================
-- Resultado esperado de SELECT * FROM misiones_priorizadas() con
-- estos datos.
--
-- OJO: la funcion devuelve "json" (un unico valor, no una fila por
-- mision), asi que "SELECT * FROM misiones_priorizadas()" trae UNA
-- fila con UNA columna que contiene este array completo:
--
-- Solo hay match cuando el mismo insumo tiene 'sobra' en algun otro
-- punto. De los 3 origenes 'sobra' sembrados (agua y colchonetas en
-- Jairo Varela, suero oral en Cruz Roja), suero oral no encuentra
-- ningun destino en no_hay/poco, asi que no genera mision. Los
-- faltantes de cobijas, kits de aseo, pañales, guantes, comida
-- preparada, ropa y medicamentos (Comuna 13) tampoco generan mision
-- porque nadie tiene 'sobra' de esos insumos todavia -- es a
-- proposito, para mostrar que el sistema detecta huecos sin
-- excedente disponible, no solo los casos felices.
--
-- [
--   {
--     "origen_id": "<uuid Jairo Varela>",
--     "destino_id": "<uuid DEMO — Albergue Comuna 20>",
--     "insumo_id": "<uuid agua>",
--     "nombre_insumo": "agua",
--     "urgencia": 106,
--     "nivel_destino": "no_hay",
--     "horas_faltando": 8.0,
--     "razon": "DEMO — Albergue Comuna 20 lleva 8h sin agua"
--   },
--   {
--     "origen_id": "<uuid Jairo Varela>",
--     "destino_id": "<uuid DEMO — Albergue Comuna 13>",
--     "insumo_id": "<uuid agua>",
--     "nombre_insumo": "agua",
--     "urgencia": 82,
--     "nivel_destino": "poco",
--     "horas_faltando": 6.0,
--     "razon": "DEMO — Albergue Comuna 13 lleva 6h con poco agua"
--   },
--   {
--     "origen_id": "<uuid Jairo Varela>",
--     "destino_id": "<uuid DEMO — Albergue Comuna 20>",
--     "insumo_id": "<uuid colchonetas>",
--     "nombre_insumo": "colchonetas",
--     "urgencia": 80,
--     "nivel_destino": "no_hay",
--     "horas_faltando": 5.0,
--     "razon": "DEMO — Albergue Comuna 20 lleva 5h sin colchonetas"
--   },
--   {
--     "origen_id": "<uuid Jairo Varela>",
--     "destino_id": "<uuid Banco de Alimentos de Cali>",
--     "insumo_id": "<uuid agua>",
--     "nombre_insumo": "agua",
--     "urgencia": 76,
--     "nivel_destino": "poco",
--     "horas_faltando": 3.0,
--     "razon": "Banco de Alimentos de Cali lleva 3h con poco agua"
--   }
-- ]
--
-- horas_faltando va a ser un poco mayor que estos numeros segun
-- cuanto tiempo pase entre sembrar y consultar (crece con now());
-- el orden por urgencia DESC y los 4 matches son estables.
-- ============================================================
