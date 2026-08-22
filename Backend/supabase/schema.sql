-- ============================================================
-- SOGR - Esquema base
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Convencion para el equipo: toda funcion SQL que exponga datos
-- geograficos a FastAPI debe devolver GeoJSON ya armado con
-- ST_AsGeoJSON + row_to_json (FeatureCollection para puntos,
-- LineString para rutas), para que FastAPI reenvie el resultado
-- tal cual sin transformarlo en Python.
--
-- Orden de ejecucion: este script asume que la tabla "users"
-- (creada por FastAPI via Base.metadata.create_all al arrancar
-- el backend) ya existe, porque inventario.actualizado_por
-- referencia public.users(id). Correr el backend al menos una
-- vez antes de aplicar este schema.
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists postgis;

-- ============================================================
-- Tablas
-- ============================================================

create table if not exists puntos_control (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  tipo           text check (tipo in ('acopio', 'albergue', 'hospital', 'comando')),
  estado         text check (estado in ('activo', 'saturado', 'cerrado', 'pendiente')),
  lat            double precision not null,
  lng            double precision not null,
  direccion      text,
  horario        text,
  telefono       text,
  responsable    text,
  responsable_user_id uuid references public.users(id),
  verificado     boolean default false,
  creado_en      timestamptz default now(),
  actualizado_en timestamptz default now()
);

create table if not exists insumos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  categoria  text check (categoria in ('agua', 'alimentos', 'aseo', 'abrigo', 'seguridad', 'salud', 'bebe', 'mascotas')),
  unidad     text,
  criticidad int check (criticidad between 1 and 5)
);

create table if not exists inventario (
  punto_id       uuid references puntos_control(id),
  insumo_id      uuid references insumos(id),
  nivel          text check (nivel in ('no_hay', 'poco', 'bien', 'sobra')),
  actualizado_en timestamptz default now(),
  actualizado_por uuid references public.users(id),
  primary key (punto_id, insumo_id)
);

create table if not exists necesidades (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null,
  descripcion    text,
  lat            double precision not null,
  lng            double precision not null,
  barrio         text,
  urgencia       int check (urgencia between 1 and 5),
  estado         text check (estado in ('pendiente', 'en_atencion', 'resuelto')) default 'pendiente',
  creado_en      timestamptz default now(),
  actualizado_en timestamptz default now()
);

create table if not exists audit_log (
  id                uuid primary key default gen_random_uuid(),
  tabla             text not null,
  operacion         text check (operacion in ('INSERT', 'UPDATE', 'DELETE')),
  registro_id       uuid,
  datos_anteriores  jsonb,
  datos_nuevos      jsonb,
  usuario_id        uuid,
  timestamp         timestamptz default now()
);

-- ============================================================
-- Auditoria (RF-15): registra INSERT/UPDATE/DELETE de
-- inventario y necesidades en audit_log con OLD/NEW como jsonb.
--
-- registro_id toma "id" cuando la tabla lo tiene (necesidades);
-- inventario no tiene PK simple (es compuesta punto_id+insumo_id),
-- asi que ahi cae al punto_id como referencia contextual y el
-- detalle completo queda en datos_anteriores/datos_nuevos.
--
-- usuario_id NO usa auth.uid(): el backend de FastAPI conecta
-- via asyncpg con el rol postgres (auth propia con JWT, sin
-- PostgREST/GoTrue), asi que auth.uid() siempre daria NULL.
-- En su lugar se lee de una variable de sesion Postgres que
-- FastAPI debe setear al abrir cada transaccion, una vez que
-- conoce el usuario autenticado:
--   SET LOCAL app.current_user_id = '<uuid del usuario>';
-- Si no se setea (ej. proceso interno, script sin usuario),
-- usuario_id queda NULL en vez de romper el INSERT/UPDATE/DELETE.
-- ============================================================

create or replace function trigger_audit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_registro_id uuid := coalesce(
    (to_jsonb(coalesce(new, old))->>'id')::uuid,
    (to_jsonb(coalesce(new, old))->>'punto_id')::uuid
  );
  v_usuario_id uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
begin
  insert into audit_log (tabla, operacion, registro_id, datos_anteriores, datos_nuevos, usuario_id)
  values (
    tg_table_name,
    tg_op,
    v_registro_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    v_usuario_id
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_inventario on inventario;
create trigger audit_inventario
  after insert or update or delete on inventario
  for each row execute function trigger_audit();

drop trigger if exists audit_necesidades on necesidades;
create trigger audit_necesidades
  after insert or update or delete on necesidades
  for each row execute function trigger_audit();

-- ============================================================
-- actualizado_en automatico en puntos_control y necesidades
-- ============================================================

create or replace function set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists set_actualizado_en_puntos_control on puntos_control;
create trigger set_actualizado_en_puntos_control
  before update on puntos_control
  for each row execute function set_actualizado_en();

drop trigger if exists set_actualizado_en_necesidades on necesidades;
create trigger set_actualizado_en_necesidades
  before update on necesidades
  for each row execute function set_actualizado_en();

-- ============================================================
-- Indices en lat/lng
-- ============================================================

create index if not exists idx_puntos_control_lat_lng on puntos_control (lat, lng);
create index if not exists idx_necesidades_lat_lng on necesidades (lat, lng);
