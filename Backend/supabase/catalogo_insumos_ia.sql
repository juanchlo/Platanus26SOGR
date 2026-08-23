-- ============================================================
-- SOGR - catalogo_insumos_ia: catalogo de insumos para contexto de IA
--
-- Idempotente: DROP ... IF EXISTS + CREATE OR REPLACE, se puede
-- correr mas de una vez sin romper nada.
--
-- Correccion (ver docs/PLAN_MASTER_OPTIMIZACION.md, hallazgo R-04):
-- la version anterior era una MATERIALIZED VIEW refrescada por un
-- trigger AFTER INSERT/UPDATE/DELETE que llamaba
-- "REFRESH MATERIALIZED VIEW CONCURRENTLY" -- Postgres prohibe
-- ejecutar ese comando dentro de una funcion/trigger (siempre corre
-- dentro de una transaccion), asi que en cuanto esta migracion se
-- aplicara, CUALQUIER insert/update/delete sobre insumos hubiera
-- fallado con "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot be
-- executed from a function".
--
-- La tabla insumos tiene ~12 filas: no hay ningun escenario en el
-- que materializar esta proyeccion trivial (5 columnas, sin joins,
-- sin agregaciones) aporte algo sobre una vista comun. Se reemplaza
-- por una VIEW normal -- siempre consistente con insumos, sin
-- trigger de refresco, sin ventana de datos obsoletos -- mas un
-- indice ordinario sobre insumos que cubre el ORDER BY de la vista
-- y de cualquier otro consumidor que liste el catalogo por
-- criticidad.
-- ============================================================

drop trigger if exists trg_refresh_catalogo_insumos_ia on insumos;
drop function if exists refresh_catalogo_insumos_ia();

-- "DROP MATERIALIZED VIEW IF EXISTS" no es suficiente para que esto sea
-- idempotente: IF EXISTS solo evita el error cuando el objeto no existe,
-- pero sigue fallando con "is not a materialized view" si esta migracion
-- ya corrio antes y catalogo_insumos_ia ya quedo convertida en VIEW normal.
-- Se chequea el tipo real en pg_matviews antes de intentar el DROP.
do $$
begin
  if exists (
    select 1 from pg_matviews
    where schemaname = 'public' and matviewname = 'catalogo_insumos_ia'
  ) then
    execute 'drop materialized view catalogo_insumos_ia';
  end if;
end;
$$;

create or replace view catalogo_insumos_ia as
select id, nombre, categoria, unidad, criticidad
from insumos
order by criticidad desc, nombre;

create index if not exists idx_insumos_criticidad_nombre
  on insumos (criticidad desc, nombre);
