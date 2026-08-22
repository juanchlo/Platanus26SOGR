-- ============================================================
-- SOGR - estado_ciudad(): snapshot global para contexto de IA
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere realtime.sql (alertas_nodos_inactivos) y
-- rediseño_inventario.sql (misiones_priorizadas actualizada,
-- inventario_con_deficit) ya aplicados.
--
-- Une en un solo JSON lo que hoy hay que pedir en 4-5 llamadas
-- separadas: conteo de puntos por estado, misiones urgentes, nodos
-- inactivos y deficit acumulado de insumos por categoria. Pensada
-- para que un agente arme un reporte/alerta de ciudad con una sola
-- llamada.
-- ============================================================

create or replace function estado_ciudad()
returns json
language sql
stable
as $$
  select json_build_object(
    'timestamp', now(),
    'puntos', (
      select json_build_object(
        'total', count(*),
        'activos', count(*) filter (where estado = 'activo'),
        'saturados', count(*) filter (where estado = 'saturado'),
        'cerrados', count(*) filter (where estado = 'cerrado')
      )
      from puntos_control
    ),
    'misiones_urgentes', misiones_priorizadas(),
    'nodos_inactivos', alertas_nodos_inactivos(),
    'deficit_total', (
      select coalesce(
        json_agg(
          json_build_object(
            'insumo', insumo,
            'categoria', categoria,
            'deficit_total', deficit_total
          )
          order by deficit_total desc
        ),
        '[]'::json
      )
      from (
        select
          i.nombre as insumo,
          i.categoria,
          sum(inv.deficit) as deficit_total
        from inventario_con_deficit inv
        join insumos i on i.id = inv.insumo_id
        where inv.deficit > 0
        group by i.id, i.nombre, i.categoria
      ) agregado_por_insumo
    )
  );
$$;
