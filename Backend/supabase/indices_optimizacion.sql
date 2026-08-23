-- ============================================================
-- SOGR - Indices de optimizacion (docs/PLAN_MASTER_OPTIMIZACION.md)
--
-- Requiere schema.sql, postgis.sql y nodos_afectados.sql ya
-- aplicados (necesidades, nodos_afectados con columna geom deben
-- existir). Idempotente: CREATE INDEX IF NOT EXISTS.
--
-- Cubre unicamente los indices de esta ronda de correcciones
-- (hallazgos R-02/R-03/R-08 del plan maestro):
--   - necesidades(estado): la fusion de incidentes (R-03) filtra
--     por estado in ('pendiente','en_atencion') antes de aplicar
--     ST_DWithin -- sin este indice parcial, ese filtro es un
--     seq scan sobre toda la tabla.
--   - nodos_afectados(geom): la columna se puebla por trigger desde
--     que se creo la tabla, pero nunca se le agrego el indice GiST
--     que necesita cualquier filtro espacial (ST_DWithin, <->)
--     sobre ella -- lo usan tanto la fusion de nodos_afectados como
--     voronoi_responsable() al resolverse por vecino mas cercano.
-- ============================================================

create index if not exists idx_necesidades_estado
  on necesidades (estado)
  where estado in ('pendiente', 'en_atencion');

create index if not exists idx_nodos_afectados_geom
  on nodos_afectados using gist (geom);
