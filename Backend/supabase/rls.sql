-- ============================================================
-- SOGR - Row Level Security (RF-14)
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql aplicado (y la tabla "users" que crea FastAPI
-- via Base.metadata.create_all, igual que en schema.sql).
--
-- LIMITACION IMPORTANTE: el backend de FastAPI conecta a Postgres
-- con el rol "postgres" (ver Backend/README.md, seccion RLS), que en
-- Supabase tiene el atributo BYPASSRLS. Postgres bypasea RLS por
-- completo para superusuario / roles BYPASSRLS, sin excepcion y sin
-- que FORCE ROW LEVEL SECURITY lo cambie. Osea: estas politicas NO
-- protegen el trafico que pasa por la API de Juan hoy -- ese control
-- sigue siendo 100% el RBAC de FastAPI (RoleChecker). Donde SI
-- aplican de verdad:
--   - Acceso directo a Supabase (Studio, anon/authenticated key desde
--     el cliente, si en algun momento se usa).
--   - Supabase Realtime (postgres_changes), que evalua RLS antes de
--     mandar cada evento a un suscriptor -- afecta directo a los
--     canales de inventario/necesidades/puntos_control que se
--     habilitaron en realtime.sql.
--
-- Identidad: no hay auth.uid() (no se usa Supabase Auth, ver
-- schema.sql). Se usa current_setting('app.current_user_id'), la
-- misma variable de sesion que ya lee trigger_audit(). Mientras la
-- conexion sea la de FastAPI-como-postgres, RLS ni se evalua; para
-- que estas policies limiten algo de verdad con una conexion que si
-- respete RLS, esa conexion tiene que setear
-- "SET LOCAL app.current_user_id = '<uuid>'" por transaccion.
--
-- Mapeo de roles: el pedido original hablaba de 'admin', 'operador'
-- y 'coordinador'. Los roles reales (domain/entities/user.py de
-- Juan) son ADMIN_GUBERNAMENTAL, OPERADOR_CAMPO, ENTE_PUBLICO, CIVIL.
-- 'admin' -> ADMIN_GUBERNAMENTAL, 'operador' -> OPERADOR_CAMPO.
-- 'coordinador' no existe como rol separado; se mapea tambien a
-- OPERADOR_CAMPO (decision tomada con el equipo) y se identifica
-- especificamente por estar asignado como responsable de un punto
-- (ver responsable_user_id mas abajo), no por el rol en si.
-- ============================================================

-- ============================================================
-- puntos_control.responsable ya existia como texto libre (nombre
-- para mostrar). Se agrega una columna separada para poder
-- identificar al usuario real asignado como coordinador de un punto,
-- que es lo que necesitan las policies de UPDATE.
-- ============================================================

alter table puntos_control add column if not exists responsable_user_id uuid references public.users(id);

-- ============================================================
-- Helpers de identidad, reusados por todas las policies.
-- ============================================================

create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

create or replace function app_current_user_role()
returns text
language sql
stable
as $$
  select role::text from public.users where id = app_current_user_id();
$$;

create or replace function es_responsable_de_punto(p_punto_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from puntos_control pc
    where pc.id = p_punto_id
      and pc.responsable_user_id = app_current_user_id()
  );
$$;

-- ============================================================
-- puntos_control
-- ============================================================

alter table puntos_control enable row level security;

drop policy if exists puntos_control_select on puntos_control;
create policy puntos_control_select on puntos_control
  for select
  using (app_current_user_id() is not null);

drop policy if exists puntos_control_insert on puntos_control;
create policy puntos_control_insert on puntos_control
  for insert
  with check (app_current_user_role() in ('OPERADOR_CAMPO', 'ADMIN_GUBERNAMENTAL'));

drop policy if exists puntos_control_update on puntos_control;
create policy puntos_control_update on puntos_control
  for update
  using (
    responsable_user_id = app_current_user_id()
    or app_current_user_role() = 'ADMIN_GUBERNAMENTAL'
  )
  with check (
    responsable_user_id = app_current_user_id()
    or app_current_user_role() = 'ADMIN_GUBERNAMENTAL'
  );

drop policy if exists puntos_control_delete on puntos_control;
create policy puntos_control_delete on puntos_control
  for delete
  using (app_current_user_role() = 'ADMIN_GUBERNAMENTAL');

-- ============================================================
-- inventario
-- ============================================================

alter table inventario enable row level security;

drop policy if exists inventario_select on inventario;
create policy inventario_select on inventario
  for select
  using (app_current_user_id() is not null);

drop policy if exists inventario_insert on inventario;
create policy inventario_insert on inventario
  for insert
  with check (
    app_current_user_role() = 'ADMIN_GUBERNAMENTAL'
    or es_responsable_de_punto(punto_id)
  );

drop policy if exists inventario_update on inventario;
create policy inventario_update on inventario
  for update
  using (
    app_current_user_role() = 'ADMIN_GUBERNAMENTAL'
    or es_responsable_de_punto(punto_id)
  )
  with check (
    app_current_user_role() = 'ADMIN_GUBERNAMENTAL'
    or es_responsable_de_punto(punto_id)
  );

drop policy if exists inventario_delete on inventario;
create policy inventario_delete on inventario
  for delete
  using (app_current_user_role() = 'ADMIN_GUBERNAMENTAL');

-- ============================================================
-- necesidades
-- ============================================================

alter table necesidades enable row level security;

drop policy if exists necesidades_select on necesidades;
create policy necesidades_select on necesidades
  for select
  using (app_current_user_id() is not null);

drop policy if exists necesidades_insert on necesidades;
create policy necesidades_insert on necesidades
  for insert
  with check (app_current_user_role() in ('OPERADOR_CAMPO', 'ADMIN_GUBERNAMENTAL'));

drop policy if exists necesidades_update on necesidades;
create policy necesidades_update on necesidades
  for update
  using (app_current_user_role() in ('OPERADOR_CAMPO', 'ADMIN_GUBERNAMENTAL'))
  with check (app_current_user_role() in ('OPERADOR_CAMPO', 'ADMIN_GUBERNAMENTAL'));

drop policy if exists necesidades_delete on necesidades;
create policy necesidades_delete on necesidades
  for delete
  using (app_current_user_role() = 'ADMIN_GUBERNAMENTAL');

-- ============================================================
-- audit_log: solo lectura para admin. INSERT solo lo hace
-- trigger_audit(), que es SECURITY DEFINER y corre con privilegios
-- del dueño de la funcion (bypasea RLS) -- por eso no hace falta
-- (ni existe forma limpia de escribir) una policy de INSERT para
-- usuarios normales: sin una policy permisiva, RLS bloquea el INSERT
-- para todo el mundo excepto el dueño/definer. UPDATE/DELETE se
-- niegan explicitamente para que quede claro que es intencional, no
-- un olvido.
-- ============================================================

alter table audit_log enable row level security;

drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log
  for select
  using (app_current_user_role() = 'ADMIN_GUBERNAMENTAL');

drop policy if exists audit_log_no_update on audit_log;
create policy audit_log_no_update on audit_log
  for update
  using (false);

drop policy if exists audit_log_no_delete on audit_log;
create policy audit_log_no_delete on audit_log
  for delete
  using (false);
