\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
    negative_warehouse bigint;
    negative_floor bigint;
    negative_machine bigint;
    assignment_drift bigint;
    broken_balance_math bigint;
    orphan_reversals bigint;
    duplicate_reversals bigint;
    missing_source_activity bigint;
BEGIN
    SELECT COUNT(*) INTO negative_warehouse
    FROM raw_material_totals WHERE total_quantity_kg < 0;
    SELECT COUNT(*) INTO negative_floor
    FROM floor_material_balance WHERE total_quantity_kg < 0;
    SELECT COUNT(*) INTO negative_machine
    FROM machine_stock_assignments WHERE quantity_kg < 0;
    SELECT COUNT(*) INTO assignment_drift
    FROM machine_stock_assignments msa
    LEFT JOIN floor_material_balance fmb
      ON fmb.material_type_id = msa.material_type_id
    WHERE msa.quantity_kg <> COALESCE(fmb.total_quantity_kg, 0);

    SELECT COUNT(*) INTO broken_balance_math
    FROM stock_activity_log
    WHERE (warehouse_opening_kg IS NOT NULL AND
           (warehouse_delta_kg IS NULL OR warehouse_closing_kg IS NULL OR
            warehouse_closing_kg <> warehouse_opening_kg + warehouse_delta_kg))
       OR (floor_opening_kg IS NOT NULL AND
           (floor_delta_kg IS NULL OR floor_closing_kg IS NULL OR
            floor_closing_kg <> floor_opening_kg + floor_delta_kg))
       OR (plant_opening_kg IS NOT NULL AND
           (plant_delta_kg IS NULL OR plant_closing_kg IS NULL OR
            plant_closing_kg <> plant_opening_kg + plant_delta_kg));

    SELECT COUNT(*) INTO orphan_reversals
    FROM stock_activity_log reversal
    LEFT JOIN stock_activity_log original
      ON original.id = reversal.reverses_activity_id
    WHERE reversal.action = 'REVERSE'
      AND original.id IS NULL;

    SELECT COUNT(*) INTO duplicate_reversals
    FROM (
        SELECT reverses_activity_id
        FROM stock_activity_log
        WHERE action = 'REVERSE'
        GROUP BY reverses_activity_id
        HAVING COUNT(*) > 1
    ) duplicates;

    SELECT COUNT(*) INTO missing_source_activity
    FROM (
        SELECT 'RAW_INPUT'::text AS source_domain, id AS source_id
        FROM raw_material_batches
        UNION ALL
        SELECT 'FLOOR_TRANSFER', id
        FROM material_movements
        WHERE movement_type = 'FLOOR_TRANSFER'
        UNION ALL
        SELECT 'PRODUCTION', id
        FROM production_logs
        UNION ALL
        SELECT 'WASTAGE', id
        FROM wastage_data
        UNION ALL
        SELECT 'MANUAL_ADJUSTMENT', id
        FROM stock_adjustments
    ) source_rows
    WHERE NOT EXISTS (
        SELECT 1
        FROM stock_activity_log activity
        WHERE activity.source_domain = source_rows.source_domain
          AND activity.source_id = source_rows.source_id
    );

    IF negative_warehouse <> 0 OR negative_floor <> 0 OR negative_machine <> 0 THEN
        RAISE EXCEPTION 'Negative stock detected (warehouse %, floor %, machine %)',
            negative_warehouse, negative_floor, negative_machine;
    END IF;
    IF assignment_drift <> 0 THEN
        RAISE EXCEPTION 'Machine assignment drift detected in % rows', assignment_drift;
    END IF;
    IF broken_balance_math <> 0 THEN
        RAISE EXCEPTION 'Broken stock activity balance math detected in % rows', broken_balance_math;
    END IF;
    IF orphan_reversals <> 0 OR duplicate_reversals <> 0 THEN
        RAISE EXCEPTION 'Invalid reversal linkage detected (orphan %, duplicate %)',
            orphan_reversals, duplicate_reversals;
    END IF;
    IF missing_source_activity <> 0 THEN
        RAISE EXCEPTION 'Operational source rows missing from activity ledger: %',
            missing_source_activity;
    END IF;
END $$;

SELECT 'warehouse' AS location, COUNT(*) AS rows,
       COALESCE(SUM(total_quantity_kg), 0) AS total_kg
FROM raw_material_totals
UNION ALL
SELECT 'floor', COUNT(*), COALESCE(SUM(total_quantity_kg), 0)
FROM floor_material_balance
UNION ALL
SELECT 'machine', COUNT(*), COALESCE(SUM(quantity_kg), 0)
FROM machine_stock_assignments;

SELECT source_domain, action, COUNT(*) AS rows,
       COALESCE(SUM(quantity_kg), 0) AS quantity_kg
FROM stock_activity_log
GROUP BY source_domain, action
ORDER BY source_domain, action;
