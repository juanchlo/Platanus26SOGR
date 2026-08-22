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

-- ============================================================
-- asignar_ayuda: cascada greedy de puntos_control para atender un
-- nodo_afectado.
--
-- 1) El candidato #1 ("Principal") es el que devuelve
--    voronoi_responsable() con las coordenadas del nodo afectado.
-- 2-3) Se mide su inventario: % de filas de `inventario` en nivel
--    'bien'/'sobra'. Si ese % (acumulado, ver mas abajo) ya es
--    >=50%, se corta ahi.
-- 4-5) Si no, se agrega como "Respaldo" el proximo punto_control
--    activo mas cercano (real, geography) dentro de radio_km que
--    todavia no este en la lista, se vuelve a medir, y se repite
--    hasta que el porcentaje ACUMULADO entre todos los candidatos
--    llegue a 50% o no queden puntos dentro del radio.
--
-- Interpretacion de "disponibilidad": nodos_afectados no tiene una
-- lista estructurada de insumos que necesita (`necesidad` es texto
-- libre), asi que "disponibilidad" se mide sobre el inventario del
-- candidato en si (que fraccion de sus insumos registrados esta en
-- 'bien'/'sobra'), y el acumulado es sobre el conjunto combinado de
-- filas de inventario de todos los candidatos considerados hasta
-- ese punto -- no el promedio simple de los porcentajes individuales.
-- Un candidato sin filas en `inventario` no suma ni resta al
-- acumulado (0/0), solo aporta si tiene datos.
--
-- Nunca lanza excepcion por nodo_afectado_id invalido: devuelve un
-- json con "error" en vez de fallar.
-- ============================================================

create or replace function asignar_ayuda(nodo_afectado_id uuid, radio_km float default 500.0)
returns json
language plpgsql
stable
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_target geography;
  v_cand_id uuid;
  v_cand_nombre text;
  v_cand_distancia numeric;
  v_cand_bien_sobra int;
  v_cand_total int;
  v_cand_pct numeric;
  v_cand_insumos json;
  v_orden int := 0;
  v_acum_bien_sobra int := 0;
  v_acum_total int := 0;
  v_acum_pct numeric := 0;
  v_ids_usados uuid[] := '{}';
  v_resultado jsonb := '[]'::jsonb;
begin
  select lat, lng into v_lat, v_lng
  from nodos_afectados
  where id = nodo_afectado_id;

  if not found then
    return json_build_object(
      'nodo_afectado_id', nodo_afectado_id,
      'error', 'nodo_afectado no encontrado',
      'candidatos', '[]'::json
    );
  end if;

  v_target := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;
  v_cand_id := (voronoi_responsable(v_lat, v_lng)->>'id')::uuid;

  if v_cand_id is null then
    return json_build_object(
      'nodo_afectado_id', nodo_afectado_id,
      'candidatos', '[]'::json
    );
  end if;

  <<cascada>>
  loop
    v_orden := v_orden + 1;
    v_ids_usados := v_ids_usados || v_cand_id;

    select pc.nombre, round((ST_Distance(pc.geom::geography, v_target) / 1000)::numeric, 3)
    into v_cand_nombre, v_cand_distancia
    from puntos_control pc
    where pc.id = v_cand_id;

    select
      count(*) filter (where inv.nivel in ('bien', 'sobra')),
      count(*),
      coalesce(json_agg(i.nombre) filter (where inv.nivel in ('bien', 'sobra')), '[]'::json)
    into v_cand_bien_sobra, v_cand_total, v_cand_insumos
    from inventario inv
    join insumos i on i.id = inv.insumo_id
    where inv.punto_id = v_cand_id;

    v_cand_pct := case when v_cand_total > 0 then round(100.0 * v_cand_bien_sobra / v_cand_total, 1) else 0 end;
    v_acum_bien_sobra := v_acum_bien_sobra + v_cand_bien_sobra;
    v_acum_total := v_acum_total + v_cand_total;
    v_acum_pct := case when v_acum_total > 0 then round(100.0 * v_acum_bien_sobra / v_acum_total, 1) else 0 end;

    v_resultado := v_resultado || jsonb_build_object(
      'orden', v_orden,
      'nombre', v_cand_nombre,
      'distancia_km', v_cand_distancia,
      'insumos_disponibles', v_cand_insumos,
      'nivel_disponibilidad_pct', v_cand_pct,
      'accion', case when v_orden = 1 then 'Principal' else 'Respaldo' end
    );

    -- disponibilidad acumulada cubierta
    exit cascada when v_acum_pct >= 50;

    -- siguiente punto_control activo mas cercano dentro del radio,
    -- que todavia no se haya usado
    select pc.id into v_cand_id
    from puntos_control pc
    where pc.estado = 'activo'
      and pc.id <> all (v_ids_usados)
      and ST_DWithin(pc.geom::geography, v_target, radio_km * 1000)
    order by pc.geom::geography <-> v_target
    limit 1;

    -- radio agotado: no hay mas candidatos dentro del radio
    exit cascada when v_cand_id is null;
  end loop;

  return json_build_object(
    'nodo_afectado_id', nodo_afectado_id,
    'radio_km', radio_km,
    'disponibilidad_acumulada_pct', v_acum_pct,
    'candidatos', v_resultado::json
  );
end;
$$;
