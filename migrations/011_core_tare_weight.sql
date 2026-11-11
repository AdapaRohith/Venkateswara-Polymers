-- 011: record the core / bobbin / packing (tare) weight on every production entry.
-- Material through the machine = gross − tare; net into the store = gross − tare − wastage.
BEGIN;

ALTER TABLE production_entries
    ADD COLUMN IF NOT EXISTS tare_kg NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (tare_kg >= 0);

ALTER TABLE production_entries DROP COLUMN IF EXISTS net_kg;
ALTER TABLE production_entries
    ADD COLUMN net_kg NUMERIC(14, 3) GENERATED ALWAYS AS (gross_kg - tare_kg - wastage_kg) STORED;

DO $$
DECLARE c text;
BEGIN
    FOR c IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'production_entries'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) LIKE '%wastage_kg < gross_kg%'
                AND pg_get_constraintdef(oid) NOT LIKE '%tare_kg%'
    LOOP
        EXECUTE format('ALTER TABLE production_entries DROP CONSTRAINT %I', c);
    END LOOP;
END $$;

ALTER TABLE production_entries DROP CONSTRAINT IF EXISTS production_entries_tare_wastage_lt_gross;
ALTER TABLE production_entries
    ADD CONSTRAINT production_entries_tare_wastage_lt_gross CHECK (tare_kg + wastage_kg < gross_kg);

COMMIT;
