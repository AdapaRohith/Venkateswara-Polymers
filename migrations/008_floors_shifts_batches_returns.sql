\set ON_ERROR_STOP on

-- Multi-location IPMS: Ground Floor / First Floor / Machine stock, AM/PM shifts,
-- production batches, stock returns and day closings.
--
-- Strictly additive. No existing row is updated or deleted, except that the new
-- `machines.floor` column is filled for machines that do not have one yet. The
-- existing Floor balance (floor_material_balance) becomes the Ground Floor
-- balance unchanged; First Floor and Machine stock start at zero, so every
-- existing warehouse/floor/plant figure is identical before and after.

BEGIN;

-- ── Machines live on a floor ──────────────────────────────────────────────
ALTER TABLE machines ADD COLUMN IF NOT EXISTS floor TEXT;
UPDATE machines
   SET floor = CASE WHEN type = 'cutting' THEN 'FIRST_FLOOR' ELSE 'GROUND_FLOOR' END
 WHERE floor IS NULL;
ALTER TABLE machines ALTER COLUMN floor SET DEFAULT 'GROUND_FLOOR';
DO $$ BEGIN
    ALTER TABLE machines ADD CONSTRAINT machines_floor_check
        CHECK (floor IN ('GROUND_FLOOR', 'FIRST_FLOOR'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── First Floor balance (Ground Floor stays in floor_material_balance) ───
CREATE TABLE IF NOT EXISTS first_floor_material_balance (
    material_type_id INTEGER PRIMARY KEY REFERENCES material_types(id),
    total_quantity_kg NUMERIC(12, 3) NOT NULL DEFAULT 0
        CONSTRAINT first_floor_material_balance_nonneg CHECK (total_quantity_kg >= 0),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Real per-machine stock (the old machine_stock_assignments stays a mirror) ─
CREATE TABLE IF NOT EXISTS machine_stock_allocations (
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    material_type_id INTEGER NOT NULL REFERENCES material_types(id),
    quantity_kg NUMERIC(12, 3) NOT NULL DEFAULT 0
        CONSTRAINT machine_stock_allocations_nonneg CHECK (quantity_kg >= 0),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (machine_id, material_type_id)
);

-- ── Location-to-location transfers ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_transfers (
    id BIGSERIAL PRIMARY KEY,
    transfer_no TEXT NOT NULL UNIQUE,
    material_id BIGINT NOT NULL REFERENCES materials_master(id),
    material_type_id BIGINT NOT NULL REFERENCES material_types(id),
    quantity_kg NUMERIC(12, 3) NOT NULL CHECK (quantity_kg > 0),
    from_location TEXT NOT NULL CHECK (from_location IN ('WAREHOUSE', 'GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINE')),
    from_machine_id INTEGER REFERENCES machines(id),
    to_location TEXT NOT NULL CHECK (to_location IN ('WAREHOUSE', 'GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINE')),
    to_machine_id INTEGER REFERENCES machines(id),
    business_date DATE NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('AM', 'PM')),
    note TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    reversed_by BIGINT REFERENCES users(id),
    reversed_at TIMESTAMP,
    CHECK ((from_location = 'MACHINE') = (from_machine_id IS NOT NULL)),
    CHECK ((to_location = 'MACHINE') = (to_machine_id IS NOT NULL)),
    CHECK (from_location <> to_location OR from_machine_id IS DISTINCT FROM to_machine_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_business_date ON stock_transfers (business_date DESC, shift);

-- ── Production batches (Ground Floor only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS production_batches (
    id BIGSERIAL PRIMARY KEY,
    batch_no TEXT NOT NULL UNIQUE,
    business_date DATE NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('AM', 'PM')),
    location TEXT NOT NULL DEFAULT 'GROUND_FLOOR' CHECK (location = 'GROUND_FLOOR'),
    note TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    reversed_by BIGINT REFERENCES users(id),
    reversed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_production_batches_business_date ON production_batches (business_date DESC, shift);

-- ── Shift + business date on entries (NULL on historical rows) ────────────
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS batch_id BIGINT REFERENCES production_batches(id);
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS shift TEXT;
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS machine_consumed_kg NUMERIC(12, 3);
CREATE INDEX IF NOT EXISTS idx_production_logs_batch ON production_logs (batch_id);
DO $$ BEGIN
    ALTER TABLE production_logs ADD CONSTRAINT production_logs_shift_check
        CHECK (shift IS NULL OR shift IN ('AM', 'PM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE material_movements ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE material_movements ADD COLUMN IF NOT EXISTS shift TEXT;
ALTER TABLE raw_material_batches ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE raw_material_batches ADD COLUMN IF NOT EXISTS shift TEXT;

-- ── Stock returns: leave the site, excluded from usage, findable by search ─
CREATE TABLE IF NOT EXISTS stock_returns (
    id BIGSERIAL PRIMARY KEY,
    return_no TEXT NOT NULL UNIQUE,
    material_id BIGINT NOT NULL REFERENCES materials_master(id),
    material_type_id BIGINT REFERENCES material_types(id),
    quantity_kg NUMERIC(12, 3) NOT NULL CHECK (quantity_kg > 0),
    location TEXT NOT NULL CHECK (location IN ('WAREHOUSE', 'GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINE')),
    machine_id INTEGER REFERENCES machines(id),
    production_batch_id BIGINT REFERENCES production_batches(id),
    business_date DATE NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('AM', 'PM')),
    returned_to TEXT,
    reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK ((location = 'MACHINE') = (machine_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_stock_returns_business_date ON stock_returns (business_date DESC);

-- ── Day closings: signed-off closing snapshot per business date ───────────
CREATE TABLE IF NOT EXISTS stock_day_closings (
    business_date DATE PRIMARY KEY,
    snapshot JSONB NOT NULL,
    note TEXT,
    closed_by BIGINT REFERENCES users(id),
    closed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Activity log: every location, business date and shift ─────────────────
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS shift TEXT;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machine_id INTEGER;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS from_location TEXT;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS to_location TEXT;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS first_floor_opening_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS first_floor_delta_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS first_floor_closing_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machine_opening_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machine_delta_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machine_closing_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machines_total_opening_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machines_total_delta_kg NUMERIC;
ALTER TABLE stock_activity_log ADD COLUMN IF NOT EXISTS machines_total_closing_kg NUMERIC;

ALTER TABLE stock_activity_log DROP CONSTRAINT IF EXISTS stock_activity_log_source_domain_check;
ALTER TABLE stock_activity_log ADD CONSTRAINT stock_activity_log_source_domain_check
    CHECK (source_domain IN (
        'RAW_INPUT', 'FLOOR_TRANSFER', 'PRODUCTION', 'WASTAGE', 'MANUAL_ADJUSTMENT',
        'STOCK_TRANSFER', 'STOCK_RETURN'
    ));
DO $$ BEGIN
    ALTER TABLE stock_activity_log ADD CONSTRAINT stock_activity_log_shift_check
        CHECK (shift IS NULL OR shift IN ('AM', 'PM'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_activity_log ADD CONSTRAINT stock_activity_log_first_floor_nonneg
        CHECK ((first_floor_opening_kg IS NULL OR first_floor_opening_kg >= 0)
           AND (first_floor_closing_kg IS NULL OR first_floor_closing_kg >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE stock_activity_log ADD CONSTRAINT stock_activity_log_machine_nonneg
        CHECK ((machine_opening_kg IS NULL OR machine_opening_kg >= 0)
           AND (machine_closing_kg IS NULL OR machine_closing_kg >= 0)
           AND (machines_total_opening_kg IS NULL OR machines_total_opening_kg >= 0)
           AND (machines_total_closing_kg IS NULL OR machines_total_closing_kg >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_stock_activity_business_date
    ON stock_activity_log ((COALESCE(business_date, occurred_at::date)) DESC);

COMMIT;
