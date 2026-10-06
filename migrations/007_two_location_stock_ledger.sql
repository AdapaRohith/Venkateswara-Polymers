\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE production_logs
    ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);

ALTER TABLE wastage_data
    ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS stock_activity_log (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'REVERSE', 'LEGACY')),
    source_domain TEXT NOT NULL CHECK (source_domain IN (
        'RAW_INPUT', 'FLOOR_TRANSFER', 'PRODUCTION', 'WASTAGE', 'MANUAL_ADJUSTMENT'
    )),
    source_id BIGINT,
    correlation_id UUID NOT NULL,
    reverses_activity_id BIGINT REFERENCES stock_activity_log(id),
    material_id BIGINT REFERENCES materials_master(id),
    material_type_id BIGINT REFERENCES material_types(id),
    quantity_kg NUMERIC NOT NULL CHECK (quantity_kg >= 0),
    warehouse_opening_kg NUMERIC CHECK (warehouse_opening_kg >= 0),
    warehouse_delta_kg NUMERIC,
    warehouse_closing_kg NUMERIC CHECK (warehouse_closing_kg >= 0),
    floor_opening_kg NUMERIC CHECK (floor_opening_kg >= 0),
    floor_delta_kg NUMERIC,
    floor_closing_kg NUMERIC CHECK (floor_closing_kg >= 0),
    plant_opening_kg NUMERIC CHECK (plant_opening_kg >= 0),
    plant_delta_kg NUMERIC,
    plant_closing_kg NUMERIC CHECK (plant_closing_kg >= 0),
    reason TEXT,
    created_by BIGINT REFERENCES users(id),
    occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_activity_occurred
    ON stock_activity_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_activity_material_occurred
    ON stock_activity_log (material_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_activity_source
    ON stock_activity_log (source_domain, source_id);

CREATE OR REPLACE FUNCTION reject_stock_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'stock_activity_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS stock_activity_append_only ON stock_activity_log;
CREATE TRIGGER stock_activity_append_only
BEFORE UPDATE OR DELETE ON stock_activity_log
FOR EACH ROW EXECUTE FUNCTION reject_stock_activity_mutation();

-- Existing records are evidence only. They do not change current balances and do
-- not invent opening/closing quantities that the old model did not preserve.
INSERT INTO stock_activity_log (
    action, source_domain, source_id, correlation_id, material_id,
    material_type_id, quantity_kg, reason, created_by, occurred_at
)
SELECT
    'LEGACY', 'RAW_INPUT', rb.id,
    (substr(md5('RAW_INPUT:' || rb.id::text), 1, 8) || '-' ||
     substr(md5('RAW_INPUT:' || rb.id::text), 9, 4) || '-' ||
     substr(md5('RAW_INPUT:' || rb.id::text), 13, 4) || '-' ||
     substr(md5('RAW_INPUT:' || rb.id::text), 17, 4) || '-' ||
     substr(md5('RAW_INPUT:' || rb.id::text), 21, 12))::uuid,
    rb.material_id, mt.id, rb.quantity_kg, rb.note, rb.created_by, rb.created_at
FROM raw_material_batches rb
LEFT JOIN material_types mt ON lower(mt.name) = lower(rb.material_name)
WHERE NOT EXISTS (
    SELECT 1 FROM stock_activity_log sal
    WHERE sal.source_domain = 'RAW_INPUT' AND sal.source_id = rb.id
);

INSERT INTO stock_activity_log (
    action, source_domain, source_id, correlation_id, material_id,
    material_type_id, quantity_kg, reason, created_by, occurred_at
)
SELECT
    'LEGACY', 'FLOOR_TRANSFER', mm.id,
    (substr(md5('FLOOR_TRANSFER:' || mm.id::text), 1, 8) || '-' ||
     substr(md5('FLOOR_TRANSFER:' || mm.id::text), 9, 4) || '-' ||
     substr(md5('FLOOR_TRANSFER:' || mm.id::text), 13, 4) || '-' ||
     substr(md5('FLOOR_TRANSFER:' || mm.id::text), 17, 4) || '-' ||
     substr(md5('FLOOR_TRANSFER:' || mm.id::text), 21, 12))::uuid,
    mm.material_id, mm.material_type_id, mm.quantity_kg, mm.note,
    mm.created_by, mm.created_at
FROM material_movements mm
WHERE mm.movement_type = 'FLOOR_TRANSFER'
  AND NOT EXISTS (
      SELECT 1 FROM stock_activity_log sal
      WHERE sal.source_domain = 'FLOOR_TRANSFER' AND sal.source_id = mm.id
  );

INSERT INTO stock_activity_log (
    action, source_domain, source_id, correlation_id, material_id,
    material_type_id, quantity_kg, created_by, occurred_at
)
SELECT
    'LEGACY', 'PRODUCTION', pl.id,
    (substr(md5('PRODUCTION:' || pl.id::text), 1, 8) || '-' ||
     substr(md5('PRODUCTION:' || pl.id::text), 9, 4) || '-' ||
     substr(md5('PRODUCTION:' || pl.id::text), 13, 4) || '-' ||
     substr(md5('PRODUCTION:' || pl.id::text), 17, 4) || '-' ||
     substr(md5('PRODUCTION:' || pl.id::text), 21, 12))::uuid,
    pl.material_id, pl.material_type_id,
    GREATEST(pl.gross_weight - pl.tare_weight, 0), pl.created_by, pl.created_at
FROM production_logs pl
WHERE NOT EXISTS (
    SELECT 1 FROM stock_activity_log sal
    WHERE sal.source_domain = 'PRODUCTION' AND sal.source_id = pl.id
);

INSERT INTO stock_activity_log (
    action, source_domain, source_id, correlation_id, material_id,
    quantity_kg, reason, created_by, occurred_at
)
SELECT
    'LEGACY', 'MANUAL_ADJUSTMENT', sa.id,
    (substr(md5('MANUAL_ADJUSTMENT:' || sa.id::text), 1, 8) || '-' ||
     substr(md5('MANUAL_ADJUSTMENT:' || sa.id::text), 9, 4) || '-' ||
     substr(md5('MANUAL_ADJUSTMENT:' || sa.id::text), 13, 4) || '-' ||
     substr(md5('MANUAL_ADJUSTMENT:' || sa.id::text), 17, 4) || '-' ||
     substr(md5('MANUAL_ADJUSTMENT:' || sa.id::text), 21, 12))::uuid,
    sa.material_id, sa.quantity_kg, sa.reason, sa.created_by, sa.created_at
FROM stock_adjustments sa
WHERE NOT EXISTS (
    SELECT 1 FROM stock_activity_log sal
    WHERE sal.source_domain = 'MANUAL_ADJUSTMENT' AND sal.source_id = sa.id
);

DO $$
DECLARE
    database_owner name;
BEGIN
    SELECT pg_get_userbyid(datdba) INTO database_owner
    FROM pg_database
    WHERE datname = current_database();
    EXECUTE format('GRANT SELECT, INSERT ON stock_activity_log TO %I', database_owner);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE stock_activity_log_id_seq TO %I', database_owner);
END $$;

COMMIT;
