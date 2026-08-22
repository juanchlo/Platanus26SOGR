-- ============================================================
-- SOGR - sinonimos_insumos: normalizacion de insumos via LLM
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql (insumos, inventario) y
-- rediseño_inventario.sql (calcular_nivel_inventario, cantidad_actual/
-- cantidad_necesaria en inventario) ya aplicados.
-- ============================================================

-- ============================================================
-- 1. Tabla sinonimos_insumos
--
-- El UNIQUE pedido lo implemento como indice unico sobre
-- lower(sinonimo) en vez de UNIQUE plano sobre la columna: toda la
-- tarea es explicitamente case-insensitive ("Agua", "AGUA" y "agua"
-- deben resolver igual), asi que la unicidad real tiene que ser
-- sobre el valor normalizado -- un UNIQUE plano dejaria colar
-- "agua potable" y "Agua Potable" como dos sinonimos distintos.
-- ============================================================

create table if not exists sinonimos_insumos (
  id         uuid primary key default gen_random_uuid(),
  sinonimo   text not null,
  insumo_id  uuid references insumos(id) not null,
  creado_en  timestamptz default now()
);

create unique index if not exists idx_sinonimos_insumos_sinonimo_lower
  on sinonimos_insumos (lower(sinonimo));

-- ============================================================
-- 2. resolver_insumo: nombre libre -> uuid del insumo canonico,
-- o NULL si no encuentra nada (el LLM decide si crear uno nuevo).
--
-- Todo se compara normalizado (lower + trim) tanto del lado del
-- input como de insumos.nombre / sinonimos_insumos.sinonimo, para
-- que "Agua", "AGUA", "  agua  " y "Agua Potable" resuelvan igual.
-- ============================================================

create or replace function resolver_insumo(nombre_libre text)
returns uuid
language plpgsql
stable
as $$
declare
  v_normalizado text := lower(trim(nombre_libre));
  v_id uuid;
begin
  -- a. coincidencia exacta en insumos.nombre
  select id into v_id
  from insumos
  where lower(nombre) = v_normalizado
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- b. coincidencia exacta en sinonimos_insumos.sinonimo
  select insumo_id into v_id
  from sinonimos_insumos
  where lower(sinonimo) = v_normalizado
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- c. coincidencia parcial en insumos.nombre
  select id into v_id
  from insumos
  where lower(nombre) ilike '%' || v_normalizado || '%'
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- d. nada encontrado
  return null;
end;
$$;

-- ============================================================
-- 3. Siembra de sinonimos conocidos para los 12 insumos del
-- catalogo. Los "titulos" de la lista pedida (agua, alimentos,
-- medicamentos, guantes) son atajos -- el nombre canonico real en
-- `insumos` es mas especifico en 3 casos: "alimentos" ->
-- "alimentos no perecederos", "medicamentos" -> "medicamentos
-- básicos", "guantes" -> "guantes de construcción". Ahi el join
-- usa el nombre real de la tabla, no el atajo de la consigna.
-- ============================================================

insert into sinonimos_insumos (sinonimo, insumo_id)
select v.sinonimo, i.id
from (
  values
    ('agua', 'agua potable'),
    ('agua', 'agua embotellada'),
    ('agua', 'agua mineral'),
    ('agua', 'h2o'),
    ('agua', 'hidratación'),

    ('alimentos no perecederos', 'comida'),
    ('alimentos no perecederos', 'víveres'),
    ('alimentos no perecederos', 'provisiones'),
    ('alimentos no perecederos', 'alimentos no perecederos'),
    ('alimentos no perecederos', 'mercado'),

    ('colchonetas', 'colchón'),
    ('colchonetas', 'colchoneta'),
    ('colchonetas', 'cama'),
    ('colchonetas', 'sleeping'),

    ('cobijas', 'frazada'),
    ('cobijas', 'manta'),
    ('cobijas', 'ruana'),
    ('cobijas', 'abrigador'),

    ('kits de aseo', 'kit higiene'),
    ('kits de aseo', 'artículos de aseo'),
    ('kits de aseo', 'implementos de higiene'),
    ('kits de aseo', 'elementos de aseo'),

    ('guantes de construcción', 'guantes de trabajo'),
    ('guantes de construcción', 'guantes de construcción'),

    ('pañales', 'pañal'),
    ('pañales', 'pañales para bebé'),

    ('medicamentos básicos', 'medicinas'),
    ('medicamentos básicos', 'fármacos'),
    ('medicamentos básicos', 'drogas'),
    ('medicamentos básicos', 'pastillas'),

    ('ropa', 'vestimenta'),
    ('ropa', 'ropa usada'),
    ('ropa', 'ropa de segunda'),

    ('comida para mascotas', 'comida para animales'),
    ('comida para mascotas', 'alimento para perros'),
    ('comida para mascotas', 'alimento para gatos'),

    ('comida preparada', 'almuerzo'),
    ('comida preparada', 'comida caliente'),
    ('comida preparada', 'ración'),
    ('comida preparada', 'tinto y pan'),

    ('suero oral', 'suero'),
    ('suero oral', 'rehidratante'),
    ('suero oral', 'electrolitos')
) as v(insumo_canonico, sinonimo)
join insumos i on i.nombre = v.insumo_canonico
on conflict ((lower(sinonimo))) do nothing;

-- ============================================================
-- 4. registrar_con_normalizacion: punto de entrada para el LLM.
-- Resuelve el insumo (o lo crea si no existe), y hace UPSERT de
-- cantidad_actual/cantidad_necesaria en inventario.
--
-- OJO: el trigger calcular_nivel_inventario() (BEFORE INSERT OR
-- UPDATE OF cantidad_actual, cantidad_necesaria, de
-- rediseño_inventario.sql) va a recalcular "nivel" solo a partir de
-- las cantidades apenas esta funcion escriba en inventario -- pisa
-- lo que se le pase como parametro `nivel`. Es intencional y
-- consistente con el rediseño de inventario numerico (nivel nunca
-- deberia ser la fuente de verdad, siempre se deriva); el parametro
-- queda solo por compatibilidad con la firma pedida.
--
-- `#variable_conflict use_column`: los parametros punto_id/nivel/
-- cantidad_actual/cantidad_necesaria tienen el mismo nombre que
-- columnas de inventario -- sin esto, el INSERT (lista de columnas)
-- y el ON CONFLICT (punto_id, insumo_id) fallan con "column
-- reference is ambiguous" (lo probe en vivo antes de dejarlo asi).
-- Esta directiva le dice a plpgsql que en esos choques gane la
-- columna de la tabla, no el parametro -- que es exactamente lo que
-- se necesita ahi. Donde no hay ninguna columna en scope (el lado
-- derecho del VALUES) el parametro se sigue leyendo normal, sin
-- ambiguedad real posible.
-- ============================================================

create or replace function registrar_con_normalizacion(
  nombre_libre text,
  punto_id uuid,
  nivel text,
  cantidad_actual int,
  cantidad_necesaria int
)
returns json
language plpgsql
as $$
#variable_conflict use_column
declare
  v_normalizado text := lower(trim(nombre_libre));
  v_insumo_id uuid;
  v_insumo_nombre text;
  v_era_sinonimo boolean;
begin
  v_insumo_id := resolver_insumo(nombre_libre);

  v_era_sinonimo := exists (
    select 1 from sinonimos_insumos where lower(sinonimo) = v_normalizado
  );

  if v_insumo_id is null then
    insert into insumos (nombre)
    values (trim(nombre_libre))
    returning id, nombre into v_insumo_id, v_insumo_nombre;
  else
    select nombre into v_insumo_nombre from insumos where id = v_insumo_id;
  end if;

  insert into inventario (punto_id, insumo_id, nivel, cantidad_actual, cantidad_necesaria, actualizado_en)
  values (punto_id, v_insumo_id, nivel, cantidad_actual, cantidad_necesaria, now())
  on conflict (punto_id, insumo_id) do update set
    nivel = excluded.nivel,
    cantidad_actual = excluded.cantidad_actual,
    cantidad_necesaria = excluded.cantidad_necesaria,
    actualizado_en = now();

  return json_build_object(
    'insumo_canonico', v_insumo_nombre,
    'era_sinonimo', v_era_sinonimo,
    'sinonimo_original', nombre_libre
  );
end;
$$;
