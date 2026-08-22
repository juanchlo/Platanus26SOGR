-- ============================================================
-- SOGR - Supabase Realtime y monitoreo de nodos (RF-05, RF-16, RF-17)
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql aplicado (inventario, necesidades,
-- puntos_control deben existir).
-- ============================================================

-- ============================================================
-- Habilita Realtime (Postgres CDC via logical replication) en
-- las tablas que el frontend necesita ver cambiar en vivo:
-- inventario -> niveles de stock (RF-05)
-- necesidades -> nuevos reportes / cambios de estado (RF-16)
-- puntos_control -> saturacion/cierre de un centro (RF-08, RF-16)
--
-- ADD TABLE falla si la tabla ya esta en la publicacion, asi que
-- lo envuelvo en un chequeo contra pg_publication_tables para
-- poder correr este script mas de una vez sin error.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventario'
  ) then
    alter publication supabase_realtime add table inventario;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'necesidades'
  ) then
    alter publication supabase_realtime add table necesidades;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'puntos_control'
  ) then
    alter publication supabase_realtime add table puntos_control;
  end if;
end;
$$;

-- ============================================================
-- alertas_nodos_inactivos (RF-17): puntos_control activos cuyo
-- inventario no se actualiza hace mas de 2 horas.
--
-- Solo considera puntos con al menos una fila en inventario -
-- un punto activo que nunca cargo inventario no tiene con que
-- comparar y no va a aparecer aca. Si eso importa (alertar
-- tambien "nunca reporto"), es un caso aparte a resolver con
-- Juan/Celery, no lo asumo por mi cuenta.
-- ============================================================

create or replace function alertas_nodos_inactivos()
returns json
language sql
stable
as $$
  with reportes as (
    select
      pc.id,
      pc.nombre,
      pc.direccion,
      max(inv.actualizado_en) as ultima_actualizacion
    from puntos_control pc
    join inventario inv on inv.punto_id = pc.id
    where pc.estado = 'activo'
    group by pc.id, pc.nombre, pc.direccion
    having max(inv.actualizado_en) < now() - interval '2 hours'
  )
  select coalesce(
    json_agg(
      json_build_object(
        'id', id,
        'nombre', nombre,
        'direccion', direccion,
        'ultima_actualizacion', ultima_actualizacion,
        'horas_sin_reporte', round(extract(epoch from (now() - ultima_actualizacion)) / 3600, 1)
      )
      order by ultima_actualizacion asc
    ),
    '[]'::json
  )
  from reportes;
$$;
