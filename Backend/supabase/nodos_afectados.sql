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
-- voronoi_responsable: dado un punto (p_lat, p_lng), devuelve el
-- punto_control activo cuya celda de Voronoi lo contiene -- ese es
-- el "responsable" geografico mas natural (todo lo que esta mas
-- cerca de el que de cualquier otro punto de control).
--
-- Simplificacion (hallazgo R-08 de docs/PLAN_MASTER_OPTIMIZACION.md):
-- la version anterior construia el diagrama de Voronoi completo con
-- ST_VoronoiPolygons(ST_Collect(geom)) y localizaba la celda que
-- contiene v_target via ST_Contains -- O(n^2) sin indice posible
-- (las celdas son geometria transitoria, no indexable), recalculado
-- en cada llamada, con un bloque exception-catch solo para caer al
-- vecino mas cercano cuando el diagrama fallaba o el punto quedaba
-- fuera de todas las celdas.
--
-- Esa rama es matematicamente redundante: por definicion de un
-- diagrama de Voronoi, la celda que contiene un punto es siempre la
-- del punto generador mas cercano (el punto generador esta a
-- distancia 0 de si mismo, menos que de cualquier otro generador, y
-- lo mismo se cumple para cualquier punto estrictamente dentro de su
-- celda). O sea: "en que celda cae v_target" y "cual es el punto_control
-- activo mas cercano a v_target" son la MISMA pregunta. La segunda se
-- resuelve en O(log n) con el operador KNN de PostGIS (<->) sobre el
-- indice GiST de puntos_control.geom (idx_puntos_control_geom), sin
-- construir ningun diagrama ni necesitar try/catch.
--
-- distancia_km sigue siendo distancia real (geography), no la
-- distancia euclidiana que usa el operador <-> para ordenar --
-- ese numero es para reportar, no para decidir.
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
  select pc.id, pc.nombre,
         round((ST_Distance(pc.geom::geography, v_target::geography) / 1000)::numeric, 3)
  into v_id, v_nombre, v_distancia_km
  from puntos_control pc
  where pc.estado = 'activo'
  order by pc.geom <-> v_target
  limit 1;

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

-- ============================================================
-- voronoi_celdas_ayuda: diagrama de Voronoi COMPLETO de los
-- puntos_control activos, devuelto como GeoJSON FeatureCollection.
--
-- A diferencia de voronoi_responsable() -- que solo resuelve "a que
-- celda pertenece este punto puntual" -- esta funcion expone las
-- geometrias de TODAS las celdas, pensada para dibujar en el mapa
-- las zonas de responsabilidad geografica de cada nodo de ayuda.
--
-- Se recalcula en vivo en cada llamada (no se persiste): con la
-- cantidad de nodos que maneja el proyecto, recomputar el diagrama
-- es barato y asi queda siempre consistente con el estado actual de
-- puntos_control sin necesidad de invalidar cache ni triggers.
--
-- Igual que voronoi_responsable(), con 0 o 1 punto_control activo
-- ST_VoronoiPolygons no arma celdas utiles (o falla) -- se atrapa y
-- se devuelve una FeatureCollection vacia en vez de romper.
-- ============================================================

create or replace function voronoi_celdas_ayuda()
returns json
language plpgsql
stable
as $$
declare
  v_features json;
begin
  begin
    select json_agg(
      json_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(cell.celda)::json,
        'properties', json_build_object(
          'punto_control_id', pc.id,
          'nombre', pc.nombre,
          'tipo', pc.tipo
        )
      )
    )
    into v_features
    from (
      select (ST_Dump(ST_VoronoiPolygons(ST_Collect(geom)))).geom as celda
      from puntos_control
      where estado = 'activo'
    ) cell
    join puntos_control pc on ST_Contains(ST_SetSRID(cell.celda, 4326), pc.geom);
  exception when others then
    v_features := null;
  end;

  return json_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(v_features, '[]'::json)
  );
end;
$$;
