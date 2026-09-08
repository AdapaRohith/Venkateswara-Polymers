-- Migration: Consolidate the raw material catalogue
--
-- The operator-facing pickers had grown a long tail of near-duplicate names that
-- nobody could tell apart on the shop floor. Three changes here:
--
--   1. "WHITER M.B" / "WHITE MB" become one consistent name, "White M.B".
--      Kept, not deleted -- it carries 89 production logs.
--   2. Every LLDPE variation (R.P LLDPE, LLDPE ( G-LENE), H.M SHRINK LLDPE,
--      LLDPE NON SLIP) is merged into plain LLDPE. Batches, movements and stock
--      totals move across so no history and no kilogram is lost.
--   3. LLDPE(042) is dropped outright -- it has no batches, movements, logs or
--      stock, so there is nothing to preserve.
--
-- LLDPE and LDPE 040 are the two grades that stay.
--
-- Run inside a transaction. Take a pg_dump first: this deletes catalogue rows.

BEGIN;

-- ── 1. Normalise the White M.B naming across all three catalogue tables ──────
UPDATE materials_master      SET name = 'White M.B' WHERE name = 'WHITER M.B';
UPDATE material_types        SET name = 'White M.B' WHERE name = 'WHITER M.B';
UPDATE material_name_mapping SET material_name = 'White M.B' WHERE material_name = 'WHITE MB';
UPDATE raw_material_totals   SET material_name = 'White M.B' WHERE material_name = 'WHITER M.B';
UPDATE raw_material_batches  SET material_name = 'White M.B' WHERE material_name = 'WHITER M.B';

-- ── 2. Merge the LLDPE variations into LLDPE ─────────────────────────────────
CREATE TEMP TABLE _merge_src ON COMMIT DROP AS
SELECT id FROM materials_master
WHERE name IN ('R.P LLDPE', 'LLDPE ( G-LENE)', 'H.M SHRINK LLDPE', 'LLDPE NON SLIP');

CREATE TEMP TABLE _lldpe ON COMMIT DROP AS
SELECT id FROM materials_master WHERE name = 'LLDPE';

DO $$
BEGIN
  IF (SELECT count(*) FROM _lldpe) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one LLDPE row in materials_master, found %',
      (SELECT count(*) FROM _lldpe);
  END IF;
END $$;

-- Fold the variations' stock into LLDPE before dropping their totals rows, so
-- the merge is quantity-neutral.
UPDATE raw_material_totals t
SET total_quantity_kg = t.total_quantity_kg + COALESCE((
      SELECT sum(s.total_quantity_kg) FROM raw_material_totals s
      WHERE s.material_id IN (SELECT id FROM _merge_src)), 0),
    updated_at = NOW()
WHERE t.material_id = (SELECT id FROM _lldpe);

DELETE FROM raw_material_totals WHERE material_id IN (SELECT id FROM _merge_src);

-- Re-point the ledger rows. The kilograms stay where they were, they are just
-- filed under LLDPE now.
UPDATE raw_material_batches
SET material_id = (SELECT id FROM _lldpe), material_name = 'LLDPE'
WHERE material_id IN (SELECT id FROM _merge_src);

UPDATE raw_material_entries
SET material_id = (SELECT id FROM _lldpe)
WHERE material_id IN (SELECT id FROM _merge_src);

UPDATE material_movements
SET material_id = (SELECT id FROM _lldpe)
WHERE material_id IN (SELECT id FROM _merge_src);

UPDATE production_logs
SET material_id = (SELECT id FROM _lldpe)
WHERE material_id IN (SELECT id FROM _merge_src);

DELETE FROM materials_master WHERE id IN (SELECT id FROM _merge_src);

-- ── 3. Drop LLDPE(042) -- unreferenced, zero stock ───────────────────────────
DELETE FROM raw_material_totals
WHERE material_id IN (SELECT id FROM materials_master WHERE name = 'LLDPE(042)');
DELETE FROM materials_master WHERE name = 'LLDPE(042)';

-- ── 4. Drop the matching material_types rows ─────────────────────────────────
-- These were auto-created by name-matched floor transfers and carry no
-- movements, logs or floor stock. floor_material_balance cascades.
DELETE FROM material_types
WHERE name IN ('R.P LLDPE', 'LLDPE ( G-LENE)', 'H.M SHRINK LLDPE')
  AND NOT EXISTS (SELECT 1 FROM material_movements m WHERE m.material_type_id = material_types.id)
  AND NOT EXISTS (SELECT 1 FROM production_logs p WHERE p.material_type_id = material_types.id)
  AND COALESCE((SELECT f.total_quantity_kg FROM floor_material_balance f
                WHERE f.material_type_id = material_types.id), 0) = 0;

COMMIT;
