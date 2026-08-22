-- ============================================================
-- SOGR - PostGIS: geometria y geocodificacion
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere Backend/supabase/schema.sql ya aplicado (puntos_control
-- y necesidades deben existir). Idempotente: se puede correr mas
-- de una vez sin romper nada.
-- ============================================================

create extension if not exists postgis;

-- ============================================================
-- Columna geom (Point, SRID 4326 = WGS84, el mismo sistema de
-- coordenadas que usan lat/lng en grados decimales).
-- ============================================================

alter table puntos_control add column if not exists geom geometry(Point, 4326);
alter table necesidades add column if not exists geom geometry(Point, 4326);

-- ============================================================
-- Sincronizacion geom <-> lat/lng
--
-- "OF lat, lng" hace que en UPDATE el trigger solo se dispare si
-- esas columnas vienen en el SET; en INSERT siempre se dispara
-- (esa restriccion de columnas no aplica a INSERT).
-- ============================================================

create or replace function sync_geom()
returns trigger
language plpgsql
as $$
begin
  new.geom := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326);
  return new;
end;
$$;

drop trigger if exists sync_geom_puntos_control on puntos_control;
create trigger sync_geom_puntos_control
  before insert or update of lat, lng on puntos_control
  for each row execute function sync_geom();

drop trigger if exists sync_geom_necesidades on necesidades;
create trigger sync_geom_necesidades
  before insert or update of lat, lng on necesidades
  for each row execute function sync_geom();

-- Backfill: filas que ya existian antes de agregar la columna geom.
update puntos_control set geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326) where geom is null;
update necesidades set geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326) where geom is null;

-- ============================================================
-- Indices espaciales GiST
-- ============================================================

create index if not exists idx_puntos_control_geom on puntos_control using gist (geom);
create index if not exists idx_necesidades_geom on necesidades using gist (geom);

-- ============================================================
-- puntos_cercanos: FeatureCollection GeoJSON con puntos_control
-- dentro de un radio (km), ordenados por distancia ascendente.
--
-- ST_DWithin(geom::geography, ...) hace el filtro de radio sobre
-- la esfera (distancia real en metros, no distancia "en grados"),
-- y sigue aprovechando el indice GiST de geom para el filtrado
-- inicial por bounding box antes de calcular la distancia exacta.
-- ============================================================

create or replace function puntos_cercanos(p_lat float, p_lng float, radio_km float)
returns json
language sql
stable
as $$
  with origen as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as geog
  ),
  cercanos as (
    select
      pc.geom,
      pc.id,
      pc.nombre,
      pc.tipo,
      pc.estado,
      pc.verificado,
      round((ST_Distance(pc.geom::geography, origen.geog) / 1000)::numeric, 3) as distancia_km
    from puntos_control pc, origen
    where ST_DWithin(pc.geom::geography, origen.geog, radio_km * 1000)
  )
  select json_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', row_to_json((
            select p from (
              select id, nombre, tipo, estado, verificado, distancia_km
            ) p
          ))
        )
        order by distancia_km asc
      ),
      '[]'::json
    )
  )
  from cercanos;
$$;

-- ============================================================
-- necesidades_en_zona: igual que puntos_cercanos pero sobre
-- necesidades. distancia_km se usa para el orden pero no va en
-- properties (no fue pedido en el spec de esta funcion).
-- ============================================================

create or replace function necesidades_en_zona(p_lat float, p_lng float, radio_km float)
returns json
language sql
stable
as $$
  with origen as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as geog
  ),
  cercanas as (
    select
      n.geom,
      n.id,
      n.tipo,
      n.descripcion,
      n.barrio,
      n.urgencia,
      n.estado,
      ST_Distance(n.geom::geography, origen.geog) as distancia_m
    from necesidades n, origen
    where ST_DWithin(n.geom::geography, origen.geog, radio_km * 1000)
  )
  select json_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(
      json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', row_to_json((
            select p from (
              select id, tipo, descripcion, barrio, urgencia, estado
            ) p
          ))
        )
        order by distancia_m asc
      ),
      '[]'::json
    )
  )
  from cercanas;
$$;
