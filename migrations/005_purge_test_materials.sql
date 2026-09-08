-- Migration: remove the three test materials from the catalogue
--
-- 'test', 'x' and 'Workflow test material' were left over from development and
-- sat in the operator's material picker alongside real stock, which is exactly
-- the kind of meaningless choice that makes the screen hard to read.
--
-- 'x' and 'Workflow test material' have no history at all. 'test' does: two
-- batches, five movements, one production log, 1000 kg of stock on the books and
-- 22.99 kg on the floor spread across eight machine assignment rows. All of it
-- is test data and all of it goes -- the log included, so the parent row can be
-- deleted rather than orphaned.
--
-- Take a pg_dump first. This is not reversible.

BEGIN;

CREATE TEMP TABLE _dead_master ON COMMIT DROP AS
SELECT id FROM materials_master WHERE name IN ('test', 'x', 'Workflow test material');

CREATE TEMP TABLE _dead_type ON COMMIT DROP AS
SELECT id FROM material_types WHERE name IN ('test', 'x', 'Workflow test material');

-- Consumption movements point at a production log by reference_id, so clear the
-- movements before the logs they describe.
DELETE FROM material_movements
WHERE material_id IN (SELECT id FROM _dead_master)
   OR material_type_id IN (SELECT id FROM _dead_type)
   OR (movement_type = 'CONSUMPTION' AND reference_id IN (
         SELECT id FROM production_logs
         WHERE material_id IN (SELECT id FROM _dead_master)
            OR material_type_id IN (SELECT id FROM _dead_type)));

DELETE FROM production_logs
WHERE material_id IN (SELECT id FROM _dead_master)
   OR material_type_id IN (SELECT id FROM _dead_type);

DELETE FROM raw_material_entries WHERE material_id IN (SELECT id FROM _dead_master);
DELETE FROM raw_material_batches WHERE material_id IN (SELECT id FROM _dead_master);
DELETE FROM raw_material_totals  WHERE material_id IN (SELECT id FROM _dead_master);

DELETE FROM machine_stock_assignments WHERE material_type_id IN (SELECT id FROM _dead_type);
DELETE FROM floor_material_balance    WHERE material_type_id IN (SELECT id FROM _dead_type);
DELETE FROM material_name_mapping     WHERE material_type_id IN (SELECT id FROM _dead_type);

DELETE FROM material_types    WHERE id IN (SELECT id FROM _dead_type);
DELETE FROM materials_master  WHERE id IN (SELECT id FROM _dead_master);

COMMIT;
