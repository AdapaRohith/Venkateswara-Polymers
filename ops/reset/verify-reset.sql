\set ON_ERROR_STOP on
\pset tuples_only on
\pset pager off

DO $$
DECLARE
    table_name text;
    row_count bigint;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'fulfillment_records', 'issue_report_attachments', 'issue_reports',
        'machine_production_logs', 'material_movements', 'order_items', 'orders',
        'production_entry_batches', 'production_logs', 'production_order_items',
        'production_orders', 'raw_material_batches', 'raw_material_entries',
        'stock_adjustments', 'stock_reset_log', 'trading_records', 'wastage_data'
    ] LOOP
        EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
        IF row_count <> 0 THEN
            RAISE EXCEPTION 'reset invariant failed: % contains % rows', table_name, row_count;
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM raw_material_totals WHERE total_quantity_kg <> 0) THEN
        RAISE EXCEPTION 'reset invariant failed: raw stock is nonzero';
    END IF;
    IF EXISTS (SELECT 1 FROM floor_material_balance WHERE total_quantity_kg <> 0) THEN
        RAISE EXCEPTION 'reset invariant failed: floor stock is nonzero';
    END IF;
    IF EXISTS (SELECT 1 FROM machine_stock_assignments WHERE quantity_kg <> 0) THEN
        RAISE EXCEPTION 'reset invariant failed: machine stock is nonzero';
    END IF;
    IF EXISTS (SELECT 1 FROM machine_state WHERE current_worker IS NOT NULL) THEN
        RAISE EXCEPTION 'reset invariant failed: machine worker state remains';
    END IF;
END $$;

SELECT 'reset verification passed' AS result;
