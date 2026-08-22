-- ============================================================
-- SOGR - Geocodificacion automatica por comuna (RF-11)
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql aplicado (tabla necesidades). Idempotente:
-- ON CONFLICT (id) DO NOTHING en el seed de comunas, CREATE OR
-- REPLACE en funcion y trigger.
--
-- Los 22 poligonos son un grid rectangular simple sobre el bbox
-- urbano de Cali (lat 3.33-3.53, lng -76.58--76.46), NO los limites
-- reales de las comunas -- son solo para que la demo tenga
-- geocodificacion funcionando. Los nombres son barrios reales de
-- Cali pero la asignacion barrio<->numero de comuna no pretende ser
-- precisa. Lo que si se garantiza a proposito:
--   1) El grid es una particion exacta del bbox (los limites de
--      cada celda coinciden con los de sus vecinas) -> cobertura
--      total, cero solape, por construccion, no por revision manual.
--   2) Los 6 puntos de control de seed.sql caen bien adentro de
--      alguna celda (nunca justo sobre un limite). Los 3 albergues
--      DEMO caen en la celda con el mismo numero que su nombre
--      (Comuna 13/18/20), a proposito, para que la demo se sienta
--      consistente entre el mapa y la geocodificacion.
-- ============================================================

create extension if not exists postgis;

-- ============================================================
-- 1. Tabla comunas
-- ============================================================

create table if not exists comunas (
  id     int primary key,
  nombre text not null,
  geom   geometry(MultiPolygon, 4326)
);

create index if not exists idx_comunas_geom on comunas using gist (geom);

-- ============================================================
-- 2. Las 22 comunas (grid rectangular, ver nota arriba)
-- ============================================================

insert into comunas (id, nombre, geom) values
  (1,  'Comuna 1 - Sucre',
    ST_GeomFromText('MULTIPOLYGON(((-76.58 3.33, -76.52 3.33, -76.52 3.37, -76.58 3.37, -76.58 3.33)))', 4326)),
  (2,  'Comuna 2 - Los Álamos',
    ST_GeomFromText('MULTIPOLYGON(((-76.52 3.33, -76.46 3.33, -76.46 3.37, -76.52 3.37, -76.52 3.33)))', 4326)),
  (3,  'Comuna 3 - Santa Elena',
    ST_GeomFromText('MULTIPOLYGON(((-76.535 3.37, -76.495 3.37, -76.495 3.405, -76.535 3.405, -76.535 3.37)))', 4326)),
  (4,  'Comuna 4 - República de Israel',
    ST_GeomFromText('MULTIPOLYGON(((-76.495 3.37, -76.46 3.37, -76.46 3.405, -76.495 3.405, -76.495 3.37)))', 4326)),
  (5,  'Comuna 5 - Chiminangos',
    ST_GeomFromText('MULTIPOLYGON(((-76.58 3.405, -76.55 3.405, -76.55 3.43, -76.58 3.43, -76.58 3.405)))', 4326)),
  (6,  'Comuna 6 - Petecuy',
    ST_GeomFromText('MULTIPOLYGON(((-76.55 3.405, -76.52 3.405, -76.52 3.43, -76.55 3.43, -76.55 3.405)))', 4326)),
  (7,  'Comuna 7 - Benjamín Herrera',
    ST_GeomFromText('MULTIPOLYGON(((-76.49 3.405, -76.46 3.405, -76.46 3.43, -76.49 3.43, -76.49 3.405)))', 4326)),
  (8,  'Comuna 8 - San Nicolás',
    ST_GeomFromText('MULTIPOLYGON(((-76.58 3.43, -76.555 3.43, -76.555 3.455, -76.58 3.455, -76.58 3.43)))', 4326)),
  (9,  'Comuna 9 - Tejares',
    ST_GeomFromText('MULTIPOLYGON(((-76.555 3.43, -76.53 3.43, -76.53 3.455, -76.555 3.455, -76.555 3.43)))', 4326)),
  (10, 'Comuna 10 - Departamental',
    ST_GeomFromText('MULTIPOLYGON(((-76.53 3.43, -76.505 3.43, -76.505 3.455, -76.53 3.455, -76.53 3.43)))', 4326)),
  (11, 'Comuna 11 - Amanecer',
    ST_GeomFromText('MULTIPOLYGON(((-76.505 3.43, -76.48 3.43, -76.48 3.455, -76.505 3.455, -76.505 3.43)))', 4326)),
  (12, 'Comuna 12 - Rodrigo Lara Bonilla',
    ST_GeomFromText('MULTIPOLYGON(((-76.48 3.43, -76.46 3.43, -76.46 3.455, -76.48 3.455, -76.48 3.43)))', 4326)),
  (13, 'Comuna 13 - El Vergel',
    ST_GeomFromText('MULTIPOLYGON(((-76.52 3.405, -76.49 3.405, -76.49 3.43, -76.52 3.43, -76.52 3.405)))', 4326)),
  (14, 'Comuna 14 - Marroquín',
    ST_GeomFromText('MULTIPOLYGON(((-76.556 3.455, -76.532 3.455, -76.532 3.49, -76.556 3.49, -76.556 3.455)))', 4326)),
  (15, 'Comuna 15 - Mojica',
    ST_GeomFromText('MULTIPOLYGON(((-76.532 3.455, -76.508 3.455, -76.508 3.49, -76.532 3.49, -76.532 3.455)))', 4326)),
  (16, 'Comuna 16 - Los Comuneros',
    ST_GeomFromText('MULTIPOLYGON(((-76.508 3.455, -76.484 3.455, -76.484 3.49, -76.508 3.49, -76.508 3.455)))', 4326)),
  (17, 'Comuna 17 - Los Guaduales',
    ST_GeomFromText('MULTIPOLYGON(((-76.484 3.455, -76.46 3.455, -76.46 3.49, -76.484 3.49, -76.484 3.455)))', 4326)),
  (18, 'Comuna 18 - Bello Horizonte',
    ST_GeomFromText('MULTIPOLYGON(((-76.58 3.37, -76.535 3.37, -76.535 3.405, -76.58 3.405, -76.58 3.37)))', 4326)),
  (19, 'Comuna 19 - Tequendama',
    ST_GeomFromText('MULTIPOLYGON(((-76.58 3.49, -76.54 3.49, -76.54 3.53, -76.58 3.53, -76.58 3.49)))', 4326)),
  (20, 'Comuna 20 - Siloé',
    ST_GeomFromText('MULTIPOLYGON(((-76.58 3.455, -76.556 3.455, -76.556 3.49, -76.58 3.49, -76.58 3.455)))', 4326)),
  (21, 'Comuna 21 - Ciudadela Desepaz',
    ST_GeomFromText('MULTIPOLYGON(((-76.54 3.49, -76.50 3.49, -76.50 3.53, -76.54 3.53, -76.54 3.49)))', 4326)),
  (22, 'Comuna 22 - Pance',
    ST_GeomFromText('MULTIPOLYGON(((-76.50 3.49, -76.46 3.49, -76.46 3.53, -76.50 3.53, -76.50 3.49)))', 4326))
on conflict (id) do nothing;

-- ============================================================
-- 3. geocodificar_barrio: nombre de la comuna que contiene el punto,
-- o 'Sin comuna asignada' si cae fuera de las 22 celdas (fuera del
-- area urbana cubierta).
-- ============================================================

create or replace function geocodificar_barrio(p_lat float, p_lng float)
returns text
language sql
stable
as $$
  select coalesce(
    (
      select nombre from comunas
      where ST_Within(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), geom)
      limit 1
    ),
    'Sin comuna asignada'
  );
$$;

-- ============================================================
-- 4. Trigger en necesidades: llena barrio automaticamente si viene
-- NULL o vacio. Es BEFORE INSERT/UPDATE modificando NEW directo (no
-- dispara un UPDATE aparte), asi que no hay riesgo de loop por
-- diseño -- igual se deja el chequeo "solo si cambia" que pediste,
-- como salvaguarda explicita.
-- ============================================================

create or replace function trigger_geocodificar_necesidad()
returns trigger
language plpgsql
as $$
declare
  v_barrio text;
begin
  if new.barrio is null or btrim(new.barrio) = '' then
    v_barrio := geocodificar_barrio(new.lat, new.lng);
    if v_barrio is distinct from new.barrio then
      new.barrio := v_barrio;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger geocodificar_necesidad
  before insert or update on necesidades
  for each row execute function trigger_geocodificar_necesidad();
