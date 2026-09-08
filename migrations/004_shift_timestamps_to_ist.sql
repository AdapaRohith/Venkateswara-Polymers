-- Migration: move stored wall-clock timestamps from UTC to IST
--
-- Every timestamp column in this schema is `timestamp without time zone`, and the
-- VPS runs on UTC, so NOW() had been storing UTC wall time. The browser then read
-- those strings back as local time, which put every displayed date and time 5h30m
-- behind reality -- and pushed anything logged after 18:30 IST onto the previous
-- calendar day.
--
-- From here the whole stack speaks IST: the asyncpg session sets timezone=Asia/Kolkata
-- and the API process runs with TZ=Asia/Kolkata, so new rows land in IST already.
-- This migration brings the existing rows onto the same clock by adding the offset
-- once.
--
-- Guarded by a marker row in system_config so a re-run is a no-op.
--
-- DATE columns (raw_material_entries.date, wastage_data.date) are operator-entered
-- calendar dates, not instants, and are deliberately left alone.

BEGIN;

DO $$
DECLARE
  col RECORD;
  shifted INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM system_config WHERE key = 'timestamps_ist_shift_applied') THEN
    RAISE NOTICE 'IST shift already applied - skipping';
    RETURN;
  END IF;

  FOR col IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp without time zone'
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = %I + INTERVAL ''5 hours 30 minutes'' WHERE %I IS NOT NULL',
      col.table_name, col.column_name, col.column_name, col.column_name);
    shifted := shifted + 1;
  END LOOP;

  -- system_config.value is numeric, so the marker records the epoch second.
  INSERT INTO system_config (key, value) VALUES ('timestamps_ist_shift_applied', extract(epoch from now()));
  RAISE NOTICE 'Shifted % timestamp columns to IST', shifted;
END $$;

COMMIT;
