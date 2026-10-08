# Two-location stock ledger rollout

This runbook deploys migration `007_two_location_stock_ledger.sql`, the matching backend, and the reviewed frontend. It keeps the existing warehouse opening balances intact: historical rows are imported as `LEGACY` evidence only and are never replayed into stock.

## Required values

Run as `root` on the application host unless a command explicitly switches to the database owner.

```bash
APP_DIR=/root/backend
SERVICE=vp-api
DB_NAME=venkateswara_polymers
DB_OWNER=admin
RELEASE_DIR=/root/releases/vp-stock-ledger
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=/root/backups/vp-stock-ledger-$STAMP
RESTORE_DB=vp_stock_ledger_restore_$STAMP
```

Keep the release migration, backend, frontend bundle, and this directory together so every deployed file can be tied to the reviewed commit.

## 1. Prove the authoritative runtime

```bash
pm2 describe "$SERVICE"
readlink -f "$APP_DIR/server.py"
sha256sum "$APP_DIR/server.py" "$RELEASE_DIR/server.py"
pm2 env "$(pm2 jlist | jq -r --arg name "$SERVICE" '.[] | select(.name==$name) | .pm_id')" | grep -E '^(pm_cwd|script path|interpreter)'
```

Do not continue unless PM2 `vp-api` runs `/root/backend/server.py` and the staged release hash matches the reviewed source.

## 2. Capture the read-only baseline

```bash
sudo -u "$DB_OWNER" psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
SELECT 'warehouse' location, COUNT(*) rows, COALESCE(SUM(total_quantity_kg),0) total_kg FROM raw_material_totals
UNION ALL SELECT 'floor', COUNT(*), COALESCE(SUM(total_quantity_kg),0) FROM floor_material_balance
UNION ALL SELECT 'machine', COUNT(*), COALESCE(SUM(quantity_kg),0) FROM machine_stock_assignments;
SELECT movement_type, COUNT(*), COALESCE(SUM(quantity_kg),0) FROM material_movements GROUP BY movement_type ORDER BY movement_type;
SELECT COUNT(*) production_rows, COUNT(created_by) attributed_rows FROM production_logs;
SELECT to_regclass('public.stock_activity_log') activity_table;
SQL
```

Save this output with the backup. Any negative balance or unexplained mismatch between floor and machine totals is a stop condition.

## 3. Create one root-only rollback bundle

```bash
install -d -m 0700 "$BACKUP_DIR"
sudo -u "$DB_OWNER" pg_dump -Fc -d "$DB_NAME" > "$BACKUP_DIR/database.dump"
cp -a "$APP_DIR" "$BACKUP_DIR/backend"
pm2 save
cp -a /root/.pm2/dump.pm2 "$BACKUP_DIR/pm2.dump"
cp -a "$RELEASE_DIR" "$BACKUP_DIR/release"
test ! -f "$APP_DIR/.env" || cp -a "$APP_DIR/.env" "$BACKUP_DIR/backend.env"
chmod -R go-rwx "$BACKUP_DIR"
(cd "$BACKUP_DIR" && find . -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
chmod 0600 "$BACKUP_DIR/SHA256SUMS"
```

Confirm the bundle is root-owned, mode `0700`, and has its SHA-256 manifest. Never print environment values.

## 4. Restore-test before touching production

```bash
sudo -u postgres createdb -O "$DB_OWNER" "$RESTORE_DB"
sudo -u "$DB_OWNER" pg_restore --exit-on-error --no-owner -d "$RESTORE_DB" < "$BACKUP_DIR/database.dump"
sudo -u "$DB_OWNER" psql -X -v ON_ERROR_STOP=1 -d "$RESTORE_DB" < "$RELEASE_DIR/migrations/007_two_location_stock_ledger.sql"
sudo -u "$DB_OWNER" psql -X -v ON_ERROR_STOP=1 -d "$RESTORE_DB" < "$RELEASE_DIR/ops/stock-ledger/verify.sql"
```

Start the staged API on an unused loopback port with `DATABASE_URL` pointing at the restore database. Confirm `/`, authentication, `/stock/activity`, and `/stock/activity/export` respond before stopping that temporary process.

Run the accounting matrix against a disposable material in the restore database:

| Step | Warehouse | Floor | Plant total |
| --- | ---: | ---: | ---: |
| Opening | 500 | 50 | 550 |
| Transfer 100 to floor | 400 | 150 | 550 |
| Consume 30 in production | 400 | 120 | 520 |
| Delete production entry | 400 | 150 | 550 |
| Delete transfer entry | 500 | 50 | 550 |

The ledger actions must be `CREATE, CREATE, REVERSE, REVERSE`. A failed restore, API start, balance, or audit assertion blocks the deployment.

## 5. Migrate and deploy backend

```bash
pm2 stop "$SERVICE"
sudo -u "$DB_OWNER" psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" < "$RELEASE_DIR/migrations/007_two_location_stock_ledger.sql"
install -o root -g root -m 0644 "$RELEASE_DIR/server.py" "$APP_DIR/server.py"
pm2 start "$SERVICE"
pm2 save
sudo -u "$DB_OWNER" psql -X -v ON_ERROR_STOP=1 -d "$DB_NAME" < "$RELEASE_DIR/ops/stock-ledger/verify.sql"
```

Migration 007 is transactional and idempotent. Keep the write outage in place if either `psql` command fails.

## 6. Production accounting smoke test

Use only a designated disposable test material. Receive/establish Warehouse 500 and Floor 50, transfer 100, consume 30, then delete the production entry and transfer entry in that order. Confirm the five states in the matrix above and the four activity actions. Reverse every smoke entry before continuing; do not delete ledger rows directly.

## 7. Deploy the reviewed frontend

Build only from the reviewed commit, then atomically switch the web root using the deployment method already configured on the host. Record the source commit and bundle SHA-256 in `$BACKUP_DIR/deployment.txt`. Do not copy source-tree `node_modules`, test artifacts, or an unreviewed local build.

## 8. Acceptance checks

Verify all of the following:

- loopback API root and authenticated stock endpoints;
- public API and public frontend over HTTPS;
- SSE refresh after a stock-changing operation;
- owner flow: receive, transfer, production, edit/delete via reversal, unified activity filters and export;
- worker flow: permitted create actions and read-only unified activity, with no owner-only controls;
- each entry page shows the entries created there, while **Stock Activity** remains an audit-only combined view;
- warehouse, floor, machine, and plant totals remain non-negative and `verify.sql` exits successfully.

## 9. Rollback

If any invariant fails, stop writes immediately:

```bash
pm2 stop "$SERVICE"
test "$(readlink -f "$APP_DIR")" = /root/backend
test -d "$BACKUP_DIR/backend"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE $DB_NAME RENAME TO ${DB_NAME}_failed_$STAMP;"
sudo -u postgres createdb -O "$DB_OWNER" "$DB_NAME"
sudo -u "$DB_OWNER" pg_restore --exit-on-error --no-owner -d "$DB_NAME" < "$BACKUP_DIR/database.dump"
mv "$APP_DIR" "${APP_DIR}.failed.$STAMP"
cp -a "$BACKUP_DIR/backend" "$APP_DIR"
cp -a "$BACKUP_DIR/pm2.dump" /root/.pm2/dump.pm2
pm2 resurrect
```

The exact-path and backup-directory checks must pass before the application directory is moved. Preserve the failed database and backend under their timestamped names until the incident is understood. Re-run the baseline queries, zero/stock invariants, loopback health, and public HTTPS checks before reopening writes.

After a successful rollout, drop only the temporary restore database:

```bash
sudo -u postgres dropdb --if-exists "$RESTORE_DB"
```
