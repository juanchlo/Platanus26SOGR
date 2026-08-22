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
