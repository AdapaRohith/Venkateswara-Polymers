# Full Operational Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purge all operational history safely and deliver one audited Add/Remove stock action with verified production recovery.

**Architecture:** Keep `raw_material_totals` as the authoritative counter and existing floor/machine tables as regenerated mirrors. Add an immutable manual-adjustment ledger and a transactional owner/admin endpoint. Perform the destructive reset only during a write freeze after a singular full restore bundle proves restorable.

**Tech Stack:** FastAPI, asyncpg, PostgreSQL, React 19, Vite, Python unittest/pytest-compatible tests, PM2, GitHub/Cloudflare deployment.

**Spec:** `docs/superpowers/specs/2026-10-05-full-operational-reset-design.md`

## Global Constraints

- Preserve users, roles, machines, material catalogs/mappings, and system configuration.
- Delete all operational history regardless of age.
- Never permit negative stock or an unaudited manual adjustment.
- Keep `raw_material_totals` authoritative; floor and machine stock remain derived mirrors.
- Do not delete older backups until the new archive has passed restoration and production verification.
- Keep production available until the brief final write freeze.

## Review Focus

- Concurrent removals from the same material must serialize and never overdraw.
- A failed ledger insert must roll back the stock and mirror updates.
- Worker tokens must receive `403` without revealing or mutating stock.
- Material names with whitespace/case differences must resolve predictably without creating duplicates.
- Reset verification must detect rows inserted during cutover rather than reporting a false clean baseline.

---

### Task 1: Adjustment schema and backend contract

**Files:**
- Create: `migrations/006_full_operational_reset.sql`
- Create: `tests/test_stock_adjustments.py`
- Modify: `server.py`

**Interfaces:**
- Produces: `normalize_stock_adjustment(body) -> tuple[str, str, float, str]`.
- Produces: `apply_manual_stock_adjustment(conn, material_id, operation, quantity_kg, reason, created_by) -> dict`.
- Produces: `POST /raw-material/adjust` and `GET /raw-material/adjustments`.

- [ ] **Step 1: Write failing validation and transaction tests**

Cover valid add/remove normalization, missing reason, non-positive quantity, invalid operation, insufficient stock, exact opening/closing values, audit insertion, mirror invocation, and rollback-compatible exceptions using a deterministic fake async connection.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_stock_adjustments.py -q`

Expected: collection/import failure because the adjustment helpers do not exist.

- [ ] **Step 3: Implement schema and minimal backend behavior**

Create `stock_adjustments` with positive quantity and operation/closing-balance checks. Implement the two helpers and owner/admin routes using the existing transaction, locking, `adjust_raw_total`, and broadcast patterns.

- [ ] **Step 4: Run focused and full backend checks**

Run: `python -m pytest tests/test_stock_adjustments.py -q`

Expected: all focused tests pass.

Run: `python -m py_compile server.py`

Expected: exit 0.

- [ ] **Step 5: Commit**

Commit message: `feat: add audited stock adjustments`

### Task 2: Single Raw Material adjustment action

**Files:**
- Create: `src/utils/stockAdjustment.js`
- Create: `tests/stockAdjustment.test.mjs`
- Modify: `src/pages/RawMaterial.jsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `POST /raw-material/adjust` and `GET /raw-material/adjustments` from Task 1.
- Produces: `previewStockAdjustment(current, operation, quantity)` and `validateStockAdjustment(input)` for UI behavior.

- [ ] **Step 1: Write failing pure-behavior tests**

Test add preview, remove preview, excessive removal, invalid quantity, and required reason with hand-derived literal expectations.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/stockAdjustment.test.mjs`

Expected: module-not-found failure for `src/utils/stockAdjustment.js`.

- [ ] **Step 3: Implement helper and dialog/history UI**

Replace the add-only total editor with one Add/Remove dialog. Require a reason, show opening/closing preview, call the adjustment endpoint, and render the immutable adjustment history table.

- [ ] **Step 4: Verify focused test and production build**

Run: `node --test tests/stockAdjustment.test.mjs`

Expected: all tests pass.

Run: `npm run build`

Expected: exit 0 with no build errors.

- [ ] **Step 5: Commit**

Commit message: `feat: add safe stock adjustment workflow`

### Task 3: Reset and recovery automation

**Files:**
- Create: `ops/reset/backup-and-verify.sh`
- Create: `ops/reset/verify-reset.sql`
- Create: `ops/reset/README.md`
- Create: `tests/test_reset_contract.py`

**Interfaces:**
- Consumes: migration `006_full_operational_reset.sql` from Task 1.
- Produces: one root-only `venkateswara-polymers-reset-<timestamp>.tar.gz` with manifest and SHA-256 file.

- [ ] **Step 1: Write failing reset-contract tests**

Test the migration against an isolated PostgreSQL database restored from a supplied dump: preserved-table counts remain equal, operational tables reach zero, all stock sums reach zero, machine workers clear, and sequences restart.

- [ ] **Step 2: Run against staging and verify RED before migration**

Run: `python -m pytest tests/test_reset_contract.py -q`

Expected: failure because the reset schema/table and clean-state contract are not yet applied.

- [ ] **Step 3: Implement backup and reset runbook**

The script must stop on errors, use explicit absolute paths, create a custom-format dump and Git bundle, preserve deployed environment inside a mode-600 archive, verify with `pg_restore --list`, restore to a uniquely named staging database, compare counts, and emit checksums/restoration instructions.

- [ ] **Step 4: Run staging restore and reset verification**

Run the backup script in verification-only mode on the VPS, restore to its generated staging database, apply migration 006, and run `ops/reset/verify-reset.sql`.

Expected: all reset invariants pass; production remains unchanged.

- [ ] **Step 5: Commit**

Commit message: `ops: add verified full reset procedure`

### Task 4: Production cutover and proof

**Files:**
- Modify remotely only through the reviewed runbook: `/root/backend/server.py`, PostgreSQL `venkateswara_polymers`, `/root/backups/`.
- Publish reviewed repository commit to `origin/main` for the frontend deployment.

**Interfaces:**
- Consumes: tested backend, migration, runbook, and frontend from Tasks 1-3.
- Produces: zeroed production baseline, deployed adjustment workflow, and singular verified rollback archive.

- [ ] **Step 1: Pre-cutover evidence**

Re-run backend tests, Node tests, frontend build, live row counts, backup inventory, and loopback/public health. Record exact results.

- [ ] **Step 2: Freeze, back up, and verify**

Stop `vp-api`, create the singular archive, validate its SHA-256, list the dump, restore the dump to a temporary database, compare pre-reset counts, and keep the service stopped only after verification succeeds.

- [ ] **Step 3: Reset and deploy atomically**

Apply migration 006 with `ON_ERROR_STOP`, install the tested backend, restart `vp-api`, and run database invariant plus HTTP health checks. Restore from the archive immediately if any required check fails.

- [ ] **Step 4: Publish frontend and validate end to end**

Push the reviewed commit to `origin/main`, verify the deployment serves the new assets, authenticate with a controlled owner test path, perform an add then equal remove adjustment, verify ledger/mirror values, and remove the temporary test records transactionally.

- [ ] **Step 5: Consolidate backups and final verification**

Delete only the explicitly inventoried older Venkateswara backups and obsolete `.bak` files. Verify exactly one new rollback archive plus its checksum remain, all operational rows and stock return to zero after the smoke test cleanup, and both API health checks return 200.

- [ ] **Step 6: Commit deployment evidence**

Commit message: `docs: record reset deployment verification`
