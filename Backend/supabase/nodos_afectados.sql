-- ============================================================
-- SOGR - nodos_afectados: tabla y triggers
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql (set_actualizado_en, tabla users),
-- postgis.sql (sync_geom) y comunas.sql (trigger_geocodificar_necesidad,
-- geocodificar_barrio) ya aplicados.
--
-- Solo tabla + triggers, sin funciones nuevas ni indices por ahora
-- (a proposito, segun lo pedido).
--
-- Los 3 triggers pedidos ("iguales a los de necesidades") son,
-- literalmente, los MISMOS triggers que ya usa necesidades -- no
-- duplico su logica, solo los engancho tambien a esta tabla:
--   - sync_geom() (postgis.sql): generica, solo lee NEW.lat/NEW.lng.
--   - trigger_geocodificar_necesidad() (comunas.sql): generica,
--     solo lee/escribe NEW.barrio/NEW.lat/NEW.lng. El nombre quedo
--     atado a "necesidades" porque nacio ahi, pero no tiene ninguna
--     referencia a esa tabla en el cuerpo -- se puede reusar tal
--     cual. No la renombro porque la tarea dice explicitamente no
--     agregar funciones.
--   - set_actualizado_en() (schema.sql): generica, solo pisa
--     NEW.actualizado_en.
-- ============================================================

create table if not exists nodos_afectados (
  id                 uuid primary key default gen_random_uuid(),
  titulo             text not null,
  descripcion        text not null,
  necesidad          text not null,
  lat                double precision not null,
  lng                double precision not null,
  geom               geometry(Point, 4326),
  severidad          int check (severidad between 1 and 5) default 3,
  personas_afectadas int default 0,
  estado             text check (estado in ('activo', 'en_atencion', 'resuelto')) default 'activo',
  barrio             text,
  creado_por         uuid references public.users(id),
  creado_en          timestamptz default now(),
  actualizado_en     timestamptz default now()
);

create or replace trigger sync_geom_nodos_afectados
  before insert or update of lat, lng on nodos_afectados
  for each row execute function sync_geom();

create or replace trigger geocodificar_nodos_afectados
  before insert or update on nodos_afectados
  for each row execute function trigger_geocodificar_necesidad();

create or replace trigger set_actualizado_en_nodos_afectados
  before update on nodos_afectados
  for each row execute function set_actualizado_en();

-- ============================================================
-- voronoi_responsable: dado un punto (p_lat, p_lng), arma el
-- diagrama de Voronoi de los puntos_control activos y devuelve el
-- punto cuya celda contiene ese punto -- ese es el "responsable"
-- geografico mas natural (todo lo que esta mas cerca de el que de
-- cualquier otro punto de control).
--
-- ST_VoronoiPolygons(ST_Collect(geom)) devuelve una coleccion de
-- poligonos SIN indicar cual celda corresponde a cual punto de
-- entrada -- por definicion de Voronoi, el punto generador siempre
-- cae estrictamente adentro de su propia celda (esta a distancia 0
-- de si mismo, menos que de cualquier otro punto), asi que
-- ST_Contains(celda, punto) es como se recupera esa relacion.
--
-- Fallback (pedido explicitamente): si el punto cae fuera de todas
-- las celdas (borde de la ciudad, fuera del area que cubre el
-- diagrama) o el diagrama no se puede construir (menos de 2 puntos
-- activos, ST_VoronoiPolygons puede fallar), se usa el punto_control
-- activo mas cercano por distancia euclidiana (geom <->, sin casteo
-- a geography) -- consistente con que el propio diagrama de Voronoi
-- ya es una construccion euclidiana, no geodesica.
--
-- distancia_km en la respuesta siempre es distancia real (geography),
-- independientemente de si el punto se resolvio por Voronoi o por el
-- fallback -- ese numero es para reportar, no para decidir.
-- ============================================================

create or replace function voronoi_responsable(p_lat float, p_lng float)
returns json
language plpgsql
stable
as $$
declare
  v_target geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  v_id uuid;
  v_nombre text;
  v_distancia_km numeric;
begin
  begin
    select pc.id, pc.nombre
    into v_id, v_nombre
    from (
      select (ST_Dump(ST_VoronoiPolygons(ST_Collect(geom)))).geom as celda
      from puntos_control
      where estado = 'activo'
    ) voronoi
    join puntos_control pc on ST_Contains(ST_SetSRID(voronoi.celda, 4326), pc.geom)
    where ST_Contains(ST_SetSRID(voronoi.celda, 4326), v_target)
    limit 1;
  exception when others then
    v_id := null;
  end;

  if v_id is null then
    select pc.id, pc.nombre
    into v_id, v_nombre
    from puntos_control pc
    where pc.estado = 'activo'
    order by pc.geom <-> v_target
    limit 1;
  end if;

  select round((ST_Distance(pc.geom::geography, v_target::geography) / 1000)::numeric, 3)
  into v_distancia_km
  from puntos_control pc
  where pc.id = v_id;

  return json_build_object(
    'id', v_id,
    'nombre', v_nombre,
    'distancia_km', v_distancia_km
  );
end;
$$;
