# IPMS rollout: floors, machine stock, AM/PM shifts, batches, returns, day ledger

Migration `008_floors_shifts_batches_returns.sql` plus the matching `server.py` and
frontend. The migration is additive and idempotent; the only existing-row write is
filling the new `machines.floor` column (production → Ground Floor, cutting → First Floor).

## Model

| Location | Table | Notes |
| --- | --- | --- |
| Warehouse | `raw_material_totals` | receipts land here |
| Ground Floor | `floor_material_balance` | the former "Floor Stock", unchanged |
| First Floor | `first_floor_material_balance` | new, starts at 0 |
| Machine | `machine_stock_allocations` | new, starts at 0 (replaces the old per-machine mirror, dropped in migration 009) |

* Transfers (`stock_transfers`) move stock between locations; plant total never changes.
  Machine stock moves only through the machine's own floor.
* Production (single entries and `production_batches`) consumes the machine's own stock
  first, then Ground Floor. Batches accept Ground Floor machines only.
* Returns (`stock_returns`, owner-only) remove stock from a location, are excluded from usage
  and from the default activity feed, and stay searchable as RETURNED.
* Every activity row carries `business_date` + `shift` (AM 08:00–20:00, PM 20:00–08:00 and
  belonging to the day it started). Reversals are filed on the original entry's day/shift.
* Day ledger: closing(D) = live balance − movements after D, so today's closing is the live
  stock and every closing equals the next day's opening. `stock_day_closings` stores an owner
  sign-off snapshot; later changes show as variance; workers cannot post into a closed day.
* 1 bag = 25 kg. All storage and maths in kg; UI shows tons from 1,000 kg.

## Rollout

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ); BK=/root/backups/vp-ipms-$STAMP
install -d -m 0700 $BK
sudo -u postgres pg_dump -Fc -d venkateswara_polymers > $BK/database.dump
cp -a /root/backend $BK/backend && pm2 save && cp -a /root/.pm2/dump.pm2 $BK/pm2.dump
PGHOST=localhost PGUSER=admin PGPASSWORD=… python ops/ipms/fingerprint.py capture venkateswara_polymers $BK/fingerprint-before.json
pm2 stop vp-api
{ printf 'SET ROLE admin;\n'; cat migrations/008_floors_shifts_batches_returns.sql; } | sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d venkateswara_polymers
install -m 0644 server.py /root/backend/server.py
pm2 start vp-api
python ops/ipms/fingerprint.py verify venkateswara_polymers $BK/fingerprint-before.json   # must print OK
```

Frontend: merge to `main` and push; Cloudflare Pages builds from GitHub `main`.

## Verification

* `python -m pytest -q tests` — unit tests (engine, shifts, bags, routes, ledger maths).
* `tests/e2e/test_ipms_api_e2e.py` — 13-step API scenario against a disposable copy of
  production (refuses production URLs).
* `tests/e2e/browser_ipms.py` — 12-step Playwright walk-through of the UI against a staging
  build (`VITE_API_URL`).
* `npm test` — unit formatting tests (`tests/units.test.mjs`).

## Rollback

`pm2 stop vp-api`, restore `$BK/database.dump` into a fresh `venkateswara_polymers`
(rename the failed one), copy `$BK/backend` back to `/root/backend`, `pm2 resurrect`,
revert the frontend commit on `main`.
