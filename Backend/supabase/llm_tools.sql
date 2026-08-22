-- ============================================================
-- SOGR - llm_tools: contrato SQL <-> agente de IA
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere nodos_afectados.sql (voronoi_responsable, asignar_ayuda)
-- ya aplicado, mas insumos/inventario de schema.sql.
--
-- Estas 4 funciones no agregan logica de negocio nueva: son
-- wrappers de "presentacion" sobre voronoi_responsable(),
-- asignar_ayuda() y el resto del schema, con las claves y la forma
-- que un LLM puede leer/narrar directo, sin que tenga que conocer
-- el resto del schema interno (nombres de columnas, uuids crudos
-- sin explicar, etc). Ninguna lanza excepcion -- todas devuelven
-- un json con "error" en vez de fallar si el id no existe.
-- ============================================================

-- ============================================================
-- tool_voronoi_responsable: quien responde geograficamente a un
-- punto (lat, lng). Wrapper de voronoi_responsable() que renombra
-- "id" -> "nodo_id" (mas explicito para el LLM que un "id" pelado).
-- ============================================================

create or replace function tool_voronoi_responsable(lat float, lng float)
returns json
language sql
stable
as $$
  select json_build_object(
    'nodo_id', v->>'id',
    'nombre', v->>'nombre',
    'distancia_km', (v->>'distancia_km')::numeric
  )
  from (select voronoi_responsable(lat, lng) as v) t;
$$;

-- ============================================================
-- tool_inventario_nodo: que tiene disponible un punto_control, en
-- 3 baldes legibles en vez de niveles crudos ('bien'/'sobra' se
-- agrupan como "disponibles" -- desde la perspectiva de "que puedo
-- sacar de aca", ambos son lo mismo).
-- ============================================================

create or replace function tool_inventario_nodo(nodo_id uuid)
returns json
language sql
stable
as $$
  select json_build_object(
    'disponibles', coalesce(
      (select json_agg(i.nombre order by i.nombre)
       from inventario inv join insumos i on i.id = inv.insumo_id
       where inv.punto_id = nodo_id and inv.nivel in ('bien', 'sobra')),
      '[]'::json
    ),
    'escasos', coalesce(
      (select json_agg(i.nombre order by i.nombre)
       from inventario inv join insumos i on i.id = inv.insumo_id
       where inv.punto_id = nodo_id and inv.nivel = 'poco'),
      '[]'::json
    ),
    'sin_stock', coalesce(
      (select json_agg(i.nombre order by i.nombre)
       from inventario inv join insumos i on i.id = inv.insumo_id
       where inv.punto_id = nodo_id and inv.nivel = 'no_hay'),
      '[]'::json
    )
  );
$$;

-- ============================================================
-- tool_plan_emergencia: arma el plan de respuesta para un
-- nodo_afectado y un resumen en prosa ya armado para narrar.
--
-- "plan" es el array "candidatos" de asignar_ayuda() tal cual (ya
-- trae orden/nombre/distancia_km/insumos_disponibles/accion, no
-- hay que reformatear nada mas). resumen_para_narrar siempre
-- describe el candidato #1 (Principal); si hubo cascada, agrega
-- una frase con el #2 y, si quedan mas respaldos despues de ese,
-- los resume como "(+N respaldos adicionales)" en vez de listarlos
-- todos -- el LLM ya tiene el detalle completo en "plan" si los
-- necesita.
-- ============================================================

create or replace function tool_plan_emergencia(nodo_afectado_id uuid)
returns json
language plpgsql
stable
as $$
declare
  v_titulo text;
  v_severidad int;
  v_necesidad text;
  v_barrio text;
  v_candidatos jsonb;
  v_principal jsonb;
  v_segundo jsonb;
  v_resto_count int;
  v_resumen text;
begin
  select titulo, severidad, necesidad, barrio
  into v_titulo, v_severidad, v_necesidad, v_barrio
  from nodos_afectados
  where id = nodo_afectado_id;

  if not found then
    return json_build_object(
      'nodo_afectado_id', nodo_afectado_id,
      'error', 'nodo_afectado no encontrado'
    );
  end if;

  v_candidatos := coalesce((asignar_ayuda(nodo_afectado_id)->'candidatos')::jsonb, '[]'::jsonb);

  if jsonb_array_length(v_candidatos) = 0 then
    v_resumen := format(
      'Emergencia de severidad %s en %s. No hay puntos de control activos disponibles para asignar.',
      v_severidad, coalesce(v_barrio, 'zona sin geocodificar')
    );
  else
    v_principal := v_candidatos -> 0;
    v_resumen := format(
      'Emergencia de severidad %s en %s. %s responde primero (%skm).',
      v_severidad,
      coalesce(v_barrio, 'zona sin geocodificar'),
      v_principal ->> 'nombre',
      v_principal ->> 'distancia_km'
    );

    if jsonb_array_length(v_candidatos) > 1 then
      v_segundo := v_candidatos -> 1;
      v_resumen := v_resumen || format(
        ' Si no alcanza: %s (%skm).',
        v_segundo ->> 'nombre',
        v_segundo ->> 'distancia_km'
      );

      v_resto_count := jsonb_array_length(v_candidatos) - 2;
      if v_resto_count > 0 then
        v_resumen := v_resumen || format(' (+%s respaldos adicionales)', v_resto_count);
      end if;
    end if;
  end if;

  return json_build_object(
    'emergencia', v_titulo,
    'severidad', v_severidad,
    'necesidad_descriptiva', v_necesidad,
    'plan', v_candidatos,
    'resumen_para_narrar', v_resumen
  );
end;
$$;

-- ============================================================
-- tool_triage_activo: todas las nodos_afectados en estado 'activo',
-- ordenadas por un score de prioridad.
--
-- score = severidad*30 + min(personas_afectadas,100) + min(horas_activo*2,40)
-- (severidad pesa mas que la cantidad de gente, y las horas activas
-- suman pero con techo, para que una emergencia vieja de baja
-- severidad no le gane a una nueva de severidad alta).
--
-- razon_prioridad trae los 3 numeros crudos en una frase (severidad,
-- personas, horas) en vez de una etiqueta generica tipo "prioridad
-- alta" -- el objetivo es que el LLM tenga con que justificar el
-- orden, no que ya venga pre-narrado.
-- ============================================================

create or replace function tool_triage_activo()
returns json
language sql
stable
as $$
  with priorizadas as (
    select
      na.titulo,
      na.severidad,
      na.personas_afectadas,
      round(extract(epoch from (now() - na.creado_en)) / 3600, 1) as horas_activo
    from nodos_afectados na
    where na.estado = 'activo'
  ),
  con_score as (
    select
      titulo,
      severidad,
      personas_afectadas,
      horas_activo,
      round(
        severidad * 30
        + least(personas_afectadas, 100)
        + least(horas_activo * 2, 40)
      ) as score
    from priorizadas
  ),
  numerado as (
    select
      row_number() over (order by score desc) as orden,
      titulo,
      score,
      format(
        'Severidad %s/5, %s personas afectadas, activa hace %sh',
        severidad, personas_afectadas, horas_activo
      ) as razon_prioridad
    from con_score
  )
  select coalesce(
    json_agg(
      json_build_object(
        'orden', orden,
        'titulo', titulo,
        'score', score,
        'razon_prioridad', razon_prioridad
      )
      order by orden
    ),
    '[]'::json
  )
  from numerado;
$$;
