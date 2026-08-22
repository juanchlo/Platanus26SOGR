-- ============================================================
-- SOGR - Rediseno de inventario: numerico en vez de cualitativo
-- Backend 1: PostgreSQL / PostGIS / pgRouting / Supabase Realtime
--
-- Requiere schema.sql y pgrouting.sql ya aplicados (inventario,
-- insumos, puntos_control, misiones_priorizadas() deben existir).
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE en
-- funcion/trigger/vista, y el backfill es un UPDATE con valores
-- fijos (re-correrlo dos veces deja el mismo resultado).
--
-- El coordinador ya no elige nivel a mano: carga cantidad_actual/
-- cantidad_necesaria y el trigger calcula nivel solo. nivel se
-- mantiene como columna real (no se elimina) porque todo lo demas
-- del sistema -- misiones_priorizadas(), alertas, RLS -- sigue
-- filtrando por nivel; recalcularlo automaticamente es mas barato
-- que reescribir esos consumidores.
-- ============================================================

-- ============================================================
-- 1. Columnas nuevas
-- ============================================================

alter table inventario
  add column if not exists cantidad_actual int check (cantidad_actual >= 0),
  add column if not exists cantidad_necesaria int check (cantidad_necesaria >= 0);

-- ============================================================
-- 2. nivel se recalcula solo cuando ambas cantidades estan
-- presentes. "OF cantidad_actual, cantidad_necesaria" hace que en
-- UPDATE el trigger solo corra si esas columnas vienen en el SET
-- (no se dispara por un update que solo toca, por ejemplo,
-- actualizado_por); en INSERT esa restriccion no aplica, siempre
-- corre. Si falta alguna cantidad, nivel no se toca -- sigue
-- valiendo lo que traiga el INSERT/UPDATE tal cual.
-- ============================================================

create or replace function calcular_nivel_inventario()
returns trigger
language plpgsql
as $$
begin
  if new.cantidad_actual is not null and new.cantidad_necesaria is not null then
    new.nivel := case
      when new.cantidad_actual = 0 then 'no_hay'
      when new.cantidad_actual < new.cantidad_necesaria * 0.25 then 'poco'
      when new.cantidad_actual < new.cantidad_necesaria * 0.75 then 'bien'
      else 'sobra'
    end;
  end if;
  return new;
end;
$$;

create or replace trigger calcular_nivel_inventario
  before insert or update of cantidad_actual, cantidad_necesaria on inventario
  for each row execute function calcular_nivel_inventario();

-- ============================================================
-- 3. Vista con el deficit (cuanto falta para llegar a lo
-- necesario). NULL cuando falta alguna de las dos cantidades --
-- no hay forma honesta de calcular un deficit sin ambos numeros.
-- ============================================================

create or replace view inventario_con_deficit as
select
  punto_id,
  insumo_id,
  nivel,
  cantidad_actual,
  cantidad_necesaria,
  case
    when cantidad_actual is null or cantidad_necesaria is null then null
    when cantidad_necesaria > cantidad_actual then cantidad_necesaria - cantidad_actual
    else 0
  end as deficit,
  actualizado_en
from inventario;

-- ============================================================
-- 4. misiones_priorizadas(): ahora lee inventario_con_deficit,
-- expone "deficit" por mision, y cuando hay deficit numerico
-- multiplica la urgencia base por (1 + deficit/100.0) -- mas
-- unidades faltantes = mas prioridad. Si deficit es NULL (el punto
-- todavia no cargo cantidades) la urgencia queda igual que antes,
-- solo por severidad/criticidad/horas, sin el factor de cantidad.
--
-- Reemplaza la version de Backend/supabase/pgrouting.sql -- esa
-- copia queda desactualizada despues de correr este archivo (ver
-- aviso al equipo).
-- ============================================================

create or replace function misiones_priorizadas()
returns json
language sql
stable
as $$
  with pares as (
    select
      origen.punto_id as origen_id,
      destino.punto_id as destino_id,
      destino.insumo_id,
      ins.nombre as nombre_insumo,
      destino.nivel as nivel_destino,
      destino.deficit,
      pc_destino.nombre as nombre_punto_destino,
      (extract(epoch from (now() - destino.actualizado_en)) / 3600)::numeric as horas_faltando,
      round(
        (
          (case when destino.nivel = 'no_hay' then 1.0 else 0.5 end) * 40
          + ins.criticidad * 10
          + least(extract(epoch from (now() - destino.actualizado_en)) / 3600 * 2, 20)
        )
        * case when destino.deficit is not null then (1 + destino.deficit / 100.0) else 1 end
      ) as urgencia
    from inventario_con_deficit destino
    join inventario_con_deficit origen
      on origen.insumo_id = destino.insumo_id
     and origen.nivel = 'sobra'
     and origen.punto_id <> destino.punto_id
    join insumos ins on ins.id = destino.insumo_id
    join puntos_control pc_destino on pc_destino.id = destino.punto_id
    where destino.nivel in ('no_hay', 'poco')
  )
  select coalesce(
    json_agg(
      json_build_object(
        'origen_id', origen_id,
        'destino_id', destino_id,
        'insumo_id', insumo_id,
        'nombre_insumo', nombre_insumo,
        'urgencia', urgencia,
        'nivel_destino', nivel_destino,
        'deficit', deficit,
        'horas_faltando', round(horas_faltando, 1),
        'razon', nombre_punto_destino || ' lleva ' || round(horas_faltando)::int || 'h ' ||
          case when nivel_destino = 'no_hay' then 'sin ' || nombre_insumo
               else 'con poco ' || nombre_insumo
          end
      )
      order by urgencia desc
    ),
    '[]'::json
  )
  from pares;
$$;

-- ============================================================
-- 5. Backfill del seed con cantidades reales. El nivel de cada
-- fila se recalcula solo via el trigger de arriba -- los valores
-- que siguen entre parentesis abajo son el resultado esperado,
-- no algo que este UPDATE fije a mano.
-- ============================================================

update inventario inv
set
  cantidad_actual = v.cantidad_actual,
  cantidad_necesaria = v.cantidad_necesaria
from (
  values
    -- Jairo Varela agua: 200/50 (sobra)
    ('Plazoleta Jairo Varela', 'agua', 200, 50),
    -- Jairo Varela colchonetas: 150/80 (sobra)
    ('Plazoleta Jairo Varela', 'colchonetas', 150, 80),
    -- Banco Alimentos agua: 20/100 (poco)
    ('Banco de Alimentos de Cali', 'agua', 20, 100),
    -- Cruz Roja suero oral: 80/30 (sobra)
    ('Cruz Roja Seccional Valle', 'suero oral', 80, 30),
    -- Albergue C20 agua: 0/200 (no_hay)
    ('DEMO — Albergue Comuna 20', 'agua', 0, 200),
    -- Albergue C20 colchonetas: 0/120 (no_hay)
    ('DEMO — Albergue Comuna 20', 'colchonetas', 0, 120),
    -- Albergue C18 cobijas: 0/80 (no_hay)
    ('DEMO — Albergue Comuna 18', 'cobijas', 0, 80),
    -- Albergue C13 agua: 15/150 (poco)
    ('DEMO — Albergue Comuna 13', 'agua', 15, 150)
) as v(punto_nombre, insumo_nombre, cantidad_actual, cantidad_necesaria)
join puntos_control pc on pc.nombre = v.punto_nombre
join insumos i on i.nombre = v.insumo_nombre
where inv.punto_id = pc.id
  and inv.insumo_id = i.id;
