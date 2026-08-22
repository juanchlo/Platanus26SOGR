-- Migration: Create catalogo_insumos_ia materialized view

CREATE MATERIALIZED VIEW IF NOT EXISTS catalogo_insumos_ia AS
SELECT id, nombre, categoria, unidad, criticidad
FROM insumos
ORDER BY criticidad DESC, nombre;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogo_insumos_ia_id ON catalogo_insumos_ia(id);

CREATE OR REPLACE FUNCTION refresh_catalogo_insumos_ia()
RETURNS trigger AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY catalogo_insumos_ia;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refresh_catalogo_insumos_ia ON insumos;
CREATE TRIGGER trg_refresh_catalogo_insumos_ia
AFTER INSERT OR UPDATE OR DELETE ON insumos
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_catalogo_insumos_ia();
