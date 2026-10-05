\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id BIGSERIAL PRIMARY KEY,
    material_id BIGINT NOT NULL REFERENCES materials_master(id),
    operation TEXT NOT NULL CHECK (operation IN ('add', 'remove')),
    quantity_kg NUMERIC NOT NULL CHECK (quantity_kg > 0),
    opening_quantity_kg NUMERIC NOT NULL CHECK (opening_quantity_kg >= 0),
    closing_quantity_kg NUMERIC NOT NULL CHECK (closing_quantity_kg >= 0),
    reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_material_created
    ON stock_adjustments (material_id, created_at DESC);

DO $$
DECLARE
    database_owner name;
BEGIN
    SELECT pg_get_userbyid(datdba) INTO database_owner
    FROM pg_database
    WHERE datname = current_database();
    EXECUTE format('GRANT SELECT, INSERT ON stock_adjustments TO %I', database_owner);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE stock_adjustments_id_seq TO %I', database_owner);
END $$;

TRUNCATE TABLE
    issue_report_attachments,
    issue_reports,
    fulfillment_records,
    order_items,
    orders,
    production_order_items,
    production_orders,
    machine_production_logs,
    production_entry_batches,
    production_logs,
    material_movements,
    raw_material_batches,
    raw_material_entries,
    stock_adjustments,
    trading_records,
    wastage_data,
    stock_reset_log
RESTART IDENTITY;

UPDATE raw_material_totals SET total_quantity_kg = 0, updated_at = NOW();
UPDATE floor_material_balance SET total_quantity_kg = 0, updated_at = NOW();
UPDATE machine_stock_assignments SET quantity_kg = 0, updated_at = NOW();
UPDATE machine_state SET current_worker = NULL, updated_at = NOW();

COMMIT;
