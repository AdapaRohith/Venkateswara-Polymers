-- 010: fresh start on the Ground Floor / 1st Floor / Roll Store / Finished Goods model.
--
-- Drops every stock, production, order and trading table of the old Warehouse-based
-- model (all figures go to zero), keeps users, machines and issue reports, and
-- renames the machines to the plant's own labels. schema.sql then creates the new
-- tables; the API also applies schema.sql on every start.
BEGIN;

DROP TABLE IF EXISTS
    raw_material_totals, raw_material_batches, raw_material_entries,
    floor_material_balance, first_floor_material_balance, machine_stock_allocations,
    machine_stock_assignments, material_movements, material_name_mapping, material_types,
    materials_master, stock_activity_log, stock_adjustments, stock_transfers, stock_returns,
    stock_day_closings, stock_reset_log, production_logs, production_batches,
    production_entry_batches, production_order_items, production_orders,
    machine_production_logs, wastage_data, fulfillment_records, order_items, orders,
    trading_records, machine_state, system_config
CASCADE;

ALTER TABLE machines DROP COLUMN IF EXISTS floor;
UPDATE machines SET name = 'MCN-' || id WHERE type = 'production' AND id BETWEEN 1 AND 5;
UPDATE machines SET name = 'CUTTING MCN-' || (id - 5) WHERE type = 'cutting' AND id BETWEEN 6 AND 8;

COMMIT;
