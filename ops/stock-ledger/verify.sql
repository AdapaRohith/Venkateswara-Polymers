\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
    negative_warehouse bigint;
    negative_floor bigint;
    negative_machine bigint;
    assignment_drift bigint;
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

    IF negative_warehouse <> 0 OR negative_floor <> 0 OR negative_machine <> 0 THEN
        RAISE EXCEPTION 'Negative stock detected (warehouse %, floor %, machine %)',
            negative_warehouse, negative_floor, negative_machine;
    END IF;
    IF assignment_drift <> 0 THEN
        RAISE EXCEPTION 'Machine assignment drift detected in % rows', assignment_drift;
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
