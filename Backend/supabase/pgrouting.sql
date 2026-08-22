-- ============================================================
-- SOGR - pgRouting: grafo logistico y rutas optimas
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql y postgis.sql ya aplicados (puntos_control,
-- insumos e inventario con geom deben existir).
--
-- Orden de uso en runtime: primero se llama inicializar_red_logistica()
-- (arma los arcos y corre pgr_createTopology) y recien despues
-- ruta_optima() puede resolver caminos, porque necesita la tabla
-- red_logistica_vertices_pgr que pgr_createTopology crea.
--
-- misiones_priorizadas() (mas abajo) lee de la vista
-- inventario_con_deficit, que recien se crea en
-- Backend/supabase/rediseño_inventario.sql (corre despues en el
-- orden de migracion). Esto no rompe el CREATE OR REPLACE de este
-- archivo -- Postgres no valida que los objetos referenciados en el
-- cuerpo de una funcion existan hasta que se invoca, no al crearla
-- -- pero misiones_priorizadas() no va a poder ejecutarse hasta que
-- ese archivo haya corrido.
-- ============================================================

create extension if not exists pgrouting;

-- ============================================================
-- red_logistica: grafo de la red logistica.
--
-- pgr_createTopology (que llama inicializar_red_logistica) necesita
-- una columna de geometria LineString para detectar que arcos
-- comparten el mismo nodo y asignar los ids enteros de source/target.
-- Esa columna no estaba en el spec original de la tabla, la agrego
-- como "the_geom" (nombre por defecto que espera pgRouting) porque
-- sin ella pgr_createTopology no tiene con que trabajar.
-- ============================================================

create table if not exists red_logistica (
  id              bigserial primary key,
  source          int,
  target          int,
  cost            double precision,
  reverse_cost    double precision,
  origen_id       uuid references puntos_control(id),
  destino_id      uuid references puntos_control(id),
  distancia_km    double precision,
  the_geom        geometry(LineString, 4326)
);

create index if not exists idx_red_logistica_the_geom on red_logistica using gist (the_geom);

-- ============================================================
-- ruta_optima: camino mas corto (por tiempo) entre dos puntos_control,
-- via pgr_dijkstra sobre red_logistica.
--
-- red_logistica.origen_id/destino_id son uuid de puntos_control, pero
-- pgr_dijkstra trabaja con ids enteros de nodo (los que asigna
-- pgr_createTopology). Por eso primero se traduce cada uuid a su
-- nodo entero buscandolo como origen o como destino de cualquier
-- arco que lo mencione.
--
-- Nunca lanza excepcion. Si algo falla -- uuid que no esta en el
-- grafo (nodo queda NULL y pgr_dijkstra rechaza vid NULL),
-- red_logistica vacia (nunca se corrio inicializar_red_logistica),
-- red_logistica_vertices_pgr todavia no existe, o no hay camino
-- entre los dos nodos -- se devuelve un Feature valido con
-- geometry:null, properties.tiempo_min:null, properties.pasos:0 en
-- vez de propagar el error a FastAPI.
-- ============================================================

create or replace function ruta_optima(p_origen uuid, p_destino uuid)
returns json
language plpgsql
stable
as $$
declare
  v_origen_node bigint;
  v_destino_node bigint;
  v_geometry json;
  v_tiempo_min numeric;
  v_pasos int;
begin
  select node into v_origen_node
  from (
    select origen_id as punto_id, source as node from red_logistica
    union all
    select destino_id as punto_id, target as node from red_logistica
  ) t
  where punto_id = p_origen
  limit 1;

  select node into v_destino_node
  from (
    select origen_id as punto_id, source as node from red_logistica
    union all
    select destino_id as punto_id, target as node from red_logistica
  ) t
  where punto_id = p_destino
  limit 1;

  begin
    with ruta as (
      select d.seq, d.node, d.edge, d.cost, d.agg_cost
      from pgr_dijkstra(
        'select id, source, target, cost, reverse_cost from red_logistica',
        v_origen_node,
        v_destino_node,
        directed := true
      ) d
    )
    select
      (select ST_AsGeoJSON(ST_MakeLine(v.the_geom order by r.seq))::json
       from ruta r
       join red_logistica_vertices_pgr v on v.id = r.node),
      (select round(max(agg_cost)::numeric, 2) from ruta),
      (select count(*)::int from ruta where edge <> -1)
    into v_geometry, v_tiempo_min, v_pasos;
  exception when others then
    -- vid NULL, tabla de vertices inexistente, grafo vacio,
    -- desconexo, o cualquier otro fallo interno de pgRouting.
    v_geometry := null;
    v_tiempo_min := null;
    v_pasos := 0;
  end;

  return json_build_object(
    'type', 'Feature',
    'geometry', v_geometry,
    'properties', json_build_object(
      'origen_id', p_origen,
      'destino_id', p_destino,
      'tiempo_min', v_tiempo_min,
      'pasos', coalesce(v_pasos, 0)
    )
  );
end;
$$;

-- ============================================================
-- misiones_priorizadas: cruza faltantes (no_hay/poco) con
-- excedentes (sobra) del mismo insumo en otro punto, y calcula
-- una urgencia para priorizar el despacho.
--
-- Lee inventario_con_deficit (Backend/supabase/rediseño_inventario.sql)
-- en vez de inventario directo: esa vista agrega "deficit"
-- (cantidad_necesaria - cantidad_actual, o NULL si el punto
-- todavia no cargo cantidades numericas). Cuando hay deficit
-- numerico, la urgencia base se multiplica por (1 + deficit/100.0)
-- -- mas unidades faltantes empujan la mision hacia arriba en la
-- prioridad. Si deficit es NULL, la urgencia queda igual que antes
-- (solo severidad + criticidad + horas).
-- ============================================================

create or replace function misiones_priorizadas()
returns json
language sql
stable
as $$
  with pares as (
    select
      origen.punto_id as origen_id,
      destino.punto_id as destino_id,
      destino.insumo_id,
      ins.nombre as nombre_insumo,
      destino.nivel as nivel_destino,
      destino.deficit,
      pc_destino.nombre as nombre_punto_destino,
      (extract(epoch from (now() - destino.actualizado_en)) / 3600)::numeric as horas_faltando,
      round(
        (
          (case when destino.nivel = 'no_hay' then 1.0 else 0.5 end) * 40
          + ins.criticidad * 10
          + least(extract(epoch from (now() - destino.actualizado_en)) / 3600 * 2, 20)
        )
        * case when destino.deficit is not null then (1 + destino.deficit / 100.0) else 1 end
      ) as urgencia
    from inventario_con_deficit destino
    join inventario_con_deficit origen
      on origen.insumo_id = destino.insumo_id
     and origen.nivel = 'sobra'
     and origen.punto_id <> destino.punto_id
    join insumos ins on ins.id = destino.insumo_id
    join puntos_control pc_destino on pc_destino.id = destino.punto_id
    where destino.nivel in ('no_hay', 'poco')
  )
  select coalesce(
    json_agg(
      json_build_object(
        'origen_id', origen_id,
        'destino_id', destino_id,
        'insumo_id', insumo_id,
        'nombre_insumo', nombre_insumo,
        'urgencia', urgencia,
        'nivel_destino', nivel_destino,
        'deficit', deficit,
        'horas_faltando', round(horas_faltando, 1),
        'razon', nombre_punto_destino || ' lleva ' || round(horas_faltando)::int || 'h ' ||
          case when nivel_destino = 'no_hay' then 'sin ' || nombre_insumo
               else 'con poco ' || nombre_insumo
          end
      )
      order by urgencia desc
    ),
    '[]'::json
  )
  from pares;
$$;

-- ============================================================
-- inicializar_red_logistica: reconstruye el grafo completo entre
-- todos los pares de puntos_control activos y recalcula la topologia.
--
-- Se puede volver a llamar cuando cambian los puntos activos; primero
-- vacia red_logistica para no acumular arcos viejos.
-- ============================================================

create or replace function inicializar_red_logistica()
returns json
language plpgsql
as $$
declare
  v_aristas int;
  v_nodos int;
begin
  truncate table red_logistica restart identity;

  insert into red_logistica (origen_id, destino_id, distancia_km, cost, reverse_cost, the_geom)
  select
    a.id,
    b.id,
    ST_Distance(a.geom::geography, b.geom::geography) / 1000,
    ST_Distance(a.geom::geography, b.geom::geography) / 1000 / 40 * 60,
    ST_Distance(a.geom::geography, b.geom::geography) / 1000 / 40 * 60,
    ST_MakeLine(a.geom, b.geom)
  from puntos_control a
  join puntos_control b on a.id < b.id
  where a.estado = 'activo' and b.estado = 'activo';

  perform pgr_createTopology('red_logistica', 0.001);

  select count(*) into v_aristas from red_logistica;
  select count(*) into v_nodos from red_logistica_vertices_pgr;

  return json_build_object('aristas', v_aristas, 'nodos', v_nodos);
end;
$$;
