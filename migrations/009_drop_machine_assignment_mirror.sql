\set ON_ERROR_STOP on

-- machine_stock_assignments only ever mirrored the pooled floor balance onto every
-- machine (derived data, never an independent record). Real per-machine stock now
-- lives in machine_stock_allocations (migration 008), and no code reads or writes
-- the mirror any more.

BEGIN;
DROP TABLE IF EXISTS machine_stock_assignments;
COMMIT;
