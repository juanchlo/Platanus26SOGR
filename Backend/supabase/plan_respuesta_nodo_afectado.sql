-- ============================================================
-- SOGR - plan de respuesta automatico en nodos_afectados
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere nodos_afectados.sql (tabla nodos_afectados, asignar_ayuda())
-- ya aplicado.
--
-- Correccion sobre lo pedido: un trigger AFTER INSERT no puede
-- persistir cambios asignando a NEW -- eso solo funciona en
-- BEFORE/INSTEAD OF; en un trigger AFTER, Postgres ignora el valor
-- de retorno para escribir la fila (la fila ya quedo escrita antes
-- de que el trigger AFTER corra). Por eso el trigger hace un UPDATE
-- explicito sobre su propia fila en vez de "asignar a NEW".
--
-- Tiene que ser AFTER (no BEFORE) por una razon real: asignar_ayuda()
-- busca el nodo_afectado por id en la tabla (SELECT ... WHERE id =
-- nodo_afectado_id) -- en BEFORE INSERT esa fila todavia no existe
-- para que la encuentre.
-- ============================================================

alter table nodos_afectados
  add column if not exists nodos_ayuda_asignados jsonb,
  add column if not exists plan_respuesta text;

create or replace function generar_plan_respuesta_nodo_afectado()
returns trigger
language plpgsql
as $$
declare
  v_plan jsonb;
  v_candidatos jsonb;
  v_texto text := '';
  v_cand jsonb;
  v_insumos text;
begin
  begin
    v_plan := asignar_ayuda(new.id, 10.0)::jsonb;
    v_candidatos := coalesce(v_plan->'candidatos', '[]'::jsonb);

    for v_cand in select * from jsonb_array_elements(v_candidatos)
    loop
      if coalesce((v_cand->>'nivel_disponibilidad_pct')::numeric, 0) > 0 then
        select coalesce(string_agg(value, '/'), '')
        into v_insumos
        from jsonb_array_elements_text(coalesce(v_cand->'insumos_disponibles', '[]'::jsonb));

        v_texto := v_texto || format(
          '%s: %s (%skm, %s). ',
          v_cand ->> 'accion',
          v_cand ->> 'nombre',
          trim_scale((v_cand ->> 'distancia_km')::numeric),
          v_insumos
        );
      end if;
    end loop;

    update nodos_afectados
    set nodos_ayuda_asignados = v_candidatos,
        plan_respuesta = nullif(btrim(v_texto), '')
    where id = new.id;
  exception when others then
    -- nunca bloquear el INSERT del nodo_afectado por un fallo al
    -- generar el plan (asignar_ayuda/voronoi ya son defensivos, pero
    -- esto es la ultima red de seguridad).
    null;
  end;

  return new;
end;
$$;

create or replace trigger generar_plan_respuesta_nodos_afectados
  after insert on nodos_afectados
  for each row execute function generar_plan_respuesta_nodo_afectado();
