-- =============================================================================
-- SOGR: Tablas para el módulo de colaboración multi-nodo
-- Idempotente: usa IF NOT EXISTS / DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. solicitudes_insumo
--    Vínculo estructurado entre nodo_afectado e insumo + cantidad necesaria.
--    El texto libre nodos_afectados.necesidad sigue siendo para el LLM;
--    esta tabla es la que el algoritmo greedy consume.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS solicitudes_insumo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nodo_afectado_id    UUID NOT NULL REFERENCES nodos_afectados(id) ON DELETE CASCADE,
    insumo_id           UUID NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
    cantidad_solicitada INTEGER NOT NULL CHECK (cantidad_solicitada > 0),
    cantidad_cubierta   INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_cubierta >= 0),
    urgencia            INTEGER NOT NULL DEFAULT 3 CHECK (urgencia BETWEEN 1 AND 5),
    estado              TEXT NOT NULL DEFAULT 'pendiente'
                            CHECK (estado IN ('pendiente', 'parcial', 'cubierta', 'cancelada')),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_nodo
    ON solicitudes_insumo(nodo_afectado_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_insumo_estado
    ON solicitudes_insumo(insumo_id, estado)
    WHERE estado IN ('pendiente', 'parcial');

-- Auto-actualizar cantidad_cubierta y estado cuando llegan asignaciones
CREATE OR REPLACE FUNCTION actualizar_cobertura_solicitud()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE solicitudes_insumo
    SET
        cantidad_cubierta = (
            SELECT COALESCE(SUM(cantidad_asignada), 0)
            FROM asignaciones_insumo
            WHERE solicitud_id = NEW.solicitud_id
              AND estado != 'cancelada'
        ),
        estado = CASE
            WHEN cantidad_cubierta >= cantidad_solicitada THEN 'cubierta'
            WHEN cantidad_cubierta > 0               THEN 'parcial'
            ELSE 'pendiente'
        END,
        actualizado_en = NOW()
    WHERE id = NEW.solicitud_id;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. asignaciones_insumo
--    Resultado del algoritmo: qué nodo de apoyo da cuánto de qué insumo
--    a qué solicitud. Cada fila = una "promesa de entrega".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asignaciones_insumo (
    id                  UUID PRIMARY KEY,               -- mismo UUID que reservation:{id} en Redis
    solicitud_id        UUID NOT NULL REFERENCES solicitudes_insumo(id) ON DELETE CASCADE,
    punto_apoyo_id      UUID NOT NULL REFERENCES puntos_control(id) ON DELETE RESTRICT,
    insumo_id           UUID NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
    cantidad_asignada   INTEGER NOT NULL CHECK (cantidad_asignada > 0),
    estado              TEXT NOT NULL DEFAULT 'pendiente'
                            CHECK (estado IN ('pendiente', 'en_transito', 'entregado', 'cancelada')),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asignaciones_solicitud
    ON asignaciones_insumo(solicitud_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_punto_apoyo
    ON asignaciones_insumo(punto_apoyo_id)
    WHERE estado != 'cancelada';

-- Trigger que actualiza cantidad_cubierta en solicitudes_insumo al insertar/actualizar asignaciones
DROP TRIGGER IF EXISTS trg_actualizar_cobertura ON asignaciones_insumo;
CREATE TRIGGER trg_actualizar_cobertura
    AFTER INSERT OR UPDATE OF estado, cantidad_asignada
    ON asignaciones_insumo
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_cobertura_solicitud();

-- ---------------------------------------------------------------------------
-- 3. Publicación Realtime para que el Frontend vea asignaciones en vivo
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE solicitudes_insumo;
        ALTER PUBLICATION supabase_realtime ADD TABLE asignaciones_insumo;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Vista útil para el mapa: plan de cobertura completo de una solicitud
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vista_plan_cobertura AS
SELECT
    si.id                           AS solicitud_id,
    na.titulo                       AS nodo_afectado,
    na.lat                          AS afectado_lat,
    na.lng                          AS afectado_lng,
    ins.nombre                      AS insumo,
    si.cantidad_solicitada,
    si.cantidad_cubierta,
    si.estado,
    si.urgencia,
    -- Detalle por nodo de apoyo
    pc.nombre                       AS punto_apoyo,
    pc.lat                          AS apoyo_lat,
    pc.lng                          AS apoyo_lng,
    ai.cantidad_asignada,
    ai.estado                       AS estado_asignacion,
    -- Distancia en metros (PostGIS)
    ST_Distance(
        ST_SetSRID(ST_MakePoint(pc.lng, pc.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(na.lng, na.lat), 4326)::geography
    )                               AS distancia_metros
FROM solicitudes_insumo si
JOIN nodos_afectados   na  ON na.id  = si.nodo_afectado_id
JOIN insumos           ins ON ins.id = si.insumo_id
LEFT JOIN asignaciones_insumo ai ON ai.solicitud_id = si.id AND ai.estado != 'cancelada'
LEFT JOIN puntos_control      pc ON pc.id = ai.punto_apoyo_id;
