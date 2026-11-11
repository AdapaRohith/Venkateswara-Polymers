-- Venkateswara Polymers IPMS schema (idempotent; run on every API start).
--
-- Stock lives in four places:
--   GROUND_FLOOR    raw material (receiving bay)          item_kind = MATERIAL
--   FIRST_FLOOR     raw material (production running stock) item_kind = MATERIAL
--   ROLL_STORE      film rolls made by the extruders       item_kind = PRODUCT (kind ROLL)
--   FINISHED_STORE  cut goods made by the cutting machines item_kind = PRODUCT (kind FINISHED)
--
-- stock_ledger is the append-only truth: every balance change is one ledger row,
-- and stock_balances is only its running total (verified by /stock/verify).

CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value NUMERIC NOT NULL);
INSERT INTO system_config (key, value) VALUES
    ('tolerance_percent', 10),
    ('reorder_below_kg', 10000),
    ('optimal_above_kg', 20000)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS materials (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    -- NULL thresholds fall back to the plant-wide system_config values.
    reorder_below_kg NUMERIC(14, 3),
    optimal_above_kg NUMERIC(14, 3),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS materials_name_ci ON materials (LOWER(BTRIM(name)));

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('ROLL', 'FINISHED')),
    code TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (kind, code)
);

CREATE TABLE IF NOT EXISTS stock_balances (
    item_kind TEXT NOT NULL CHECK (item_kind IN ('MATERIAL', 'PRODUCT')),
    item_id INTEGER NOT NULL,
    location TEXT NOT NULL CHECK (location IN ('GROUND_FLOOR', 'FIRST_FLOOR', 'ROLL_STORE', 'FINISHED_STORE')),
    qty_kg NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (qty_kg >= 0),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (item_kind, item_id, location)
);

CREATE TABLE IF NOT EXISTS stock_ledger (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
    business_date DATE NOT NULL,
    shift TEXT NOT NULL CHECK (shift IN ('AM', 'PM')),
    doc_type TEXT NOT NULL CHECK (doc_type IN ('RECEIPT', 'TRANSFER', 'EXTRUSION', 'CUTTING', 'ADJUSTMENT', 'DISPATCH')),
    doc_id INTEGER NOT NULL,
    doc_no TEXT,
    item_kind TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    location TEXT NOT NULL,
    delta_kg NUMERIC(14, 3) NOT NULL,
    balance_after_kg NUMERIC(14, 3) NOT NULL,
    is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    created_by INTEGER
);
CREATE INDEX IF NOT EXISTS stock_ledger_bd ON stock_ledger (business_date);
CREATE INDEX IF NOT EXISTS stock_ledger_doc ON stock_ledger (doc_type, doc_id);
CREATE INDEX IF NOT EXISTS stock_ledger_item ON stock_ledger (item_kind, item_id, location);

-- Common columns on every stock document: business date + shift, the clock the
-- entry is stamped with, who made it, and reversal state (documents are never
-- deleted; a reversal posts the opposite ledger rows on the same day/shift).
CREATE TABLE IF NOT EXISTS stock_receipts (
    id SERIAL PRIMARY KEY,
    doc_no TEXT NOT NULL UNIQUE,
    material_id INTEGER NOT NULL REFERENCES materials(id),
    location TEXT NOT NULL CHECK (location IN ('GROUND_FLOOR', 'FIRST_FLOOR')),
    quantity_kg NUMERIC(14, 3) NOT NULL CHECK (quantity_kg > 0),
    batch_no TEXT,
    supplier TEXT,
    note TEXT,
    business_date DATE NOT NULL,
    shift TEXT NOT NULL,
    entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
    reversed_by INTEGER,
    reversed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_transfers (
    id SERIAL PRIMARY KEY,
    doc_no TEXT NOT NULL UNIQUE,
    material_id INTEGER NOT NULL REFERENCES materials(id),
    from_location TEXT NOT NULL CHECK (from_location IN ('GROUND_FLOOR', 'FIRST_FLOOR')),
    to_location TEXT NOT NULL CHECK (to_location IN ('GROUND_FLOOR', 'FIRST_FLOOR')),
    quantity_kg NUMERIC(14, 3) NOT NULL CHECK (quantity_kg > 0),
    note TEXT,
    business_date DATE NOT NULL,
    shift TEXT NOT NULL,
    entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
    reversed_by INTEGER,
    reversed_at TIMESTAMP,
    CHECK (from_location <> to_location)
);

-- One row per weighed output: an extruder roll (EXTRUSION) or a cutting run (CUTTING).
-- gross_kg is the weighed weight; tare_kg the core / bobbin / packing weighed with it;
-- gross − tare is the material that went through the machine; wastage_kg is the scrap
-- part of that; net_kg is good output that enters the store.
CREATE TABLE IF NOT EXISTS production_entries (
    id SERIAL PRIMARY KEY,
    doc_no TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('EXTRUSION', 'CUTTING')),
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    input_product_id INTEGER REFERENCES products(id),
    output_product_id INTEGER NOT NULL REFERENCES products(id),
    gross_kg NUMERIC(14, 3) NOT NULL CHECK (gross_kg > 0),
    tare_kg NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (tare_kg >= 0),
    wastage_kg NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (wastage_kg >= 0),
    net_kg NUMERIC(14, 3) GENERATED ALWAYS AS (gross_kg - tare_kg - wastage_kg) STORED,
    wastage_to_regrind BOOLEAN NOT NULL DEFAULT TRUE,
    worker_name TEXT,
    note TEXT,
    business_date DATE NOT NULL,
    shift TEXT NOT NULL,
    entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
    reversed_by INTEGER,
    reversed_at TIMESTAMP,
    CHECK (tare_kg + wastage_kg < gross_kg),
    CHECK ((kind = 'CUTTING') = (input_product_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS production_entries_bd ON production_entries (business_date, shift);

-- The resin blend an extrusion entry used (sum = gross_kg).
CREATE TABLE IF NOT EXISTS production_inputs (
    id SERIAL PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES production_entries(id),
    material_id INTEGER NOT NULL REFERENCES materials(id),
    location TEXT NOT NULL CHECK (location IN ('GROUND_FLOOR', 'FIRST_FLOOR')),
    quantity_kg NUMERIC(14, 3) NOT NULL CHECK (quantity_kg > 0)
);
CREATE INDEX IF NOT EXISTS production_inputs_entry ON production_inputs (entry_id);

-- Physical count, correction, return to supplier, damage — for any item in any store.
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id SERIAL PRIMARY KEY,
    doc_no TEXT NOT NULL UNIQUE,
    item_kind TEXT NOT NULL CHECK (item_kind IN ('MATERIAL', 'PRODUCT')),
    item_id INTEGER NOT NULL,
    location TEXT NOT NULL,
    reason_type TEXT NOT NULL CHECK (reason_type IN ('COUNT', 'CORRECTION', 'RETURN', 'DAMAGE')),
    counted_kg NUMERIC(14, 3),
    delta_kg NUMERIC(14, 3) NOT NULL,
    reason TEXT NOT NULL,
    business_date DATE NOT NULL,
    shift TEXT NOT NULL,
    entered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
    reversed_by INTEGER,
    reversed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_day_closings (
    business_date DATE PRIMARY KEY,
    snapshot JSONB NOT NULL,
    note TEXT,
    closed_by INTEGER,
    closed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Orders and dispatches. A dispatch (fulfillment record) takes goods out of the
-- Roll Store or Finished Goods Store through the ledger.
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number TEXT UNIQUE,
    client_name TEXT,
    status TEXT NOT NULL DEFAULT 'Active',
    order_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    product_id INTEGER REFERENCES products(id),
    required_quantity NUMERIC(12, 3) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE TABLE IF NOT EXISTS fulfillment_records (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    supplied_quantity NUMERIC(12, 3) NOT NULL,
    note TEXT,
    business_date DATE,
    shift TEXT,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE fulfillment_records ADD COLUMN IF NOT EXISTS business_date DATE;
ALTER TABLE fulfillment_records ADD COLUMN IF NOT EXISTS shift TEXT;
CREATE INDEX IF NOT EXISTS idx_fulfillment_records_order_id ON fulfillment_records(order_id);

CREATE TABLE IF NOT EXISTS trading_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE,
    order_number TEXT,
    material_name TEXT,
    net_weight NUMERIC,
    rate NUMERIC,
    total_value NUMERIC,
    type TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS machine_state (
    machine_id BIGINT PRIMARY KEY,
    current_worker TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issue_reports (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    page_url TEXT NOT NULL DEFAULT '',
    app_version VARCHAR(100) NOT NULL DEFAULT '',
    created_by INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_issue_reports_created_at ON issue_reports(created_at DESC);
CREATE TABLE IF NOT EXISTS issue_report_attachments (
    id SERIAL PRIMARY KEY,
    report_id INTEGER NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_issue_attachments_report_id ON issue_report_attachments(report_id);
