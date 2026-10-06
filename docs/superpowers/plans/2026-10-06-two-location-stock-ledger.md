# Two-Location Stock Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make warehouse-to-floor transfers and production usage update separate balances exactly once, while giving users editable entries on each source page and one immutable Stock Activity page that explains every change.

**Architecture:** PostgreSQL stores Warehouse Stock in `raw_material_totals`, independent Floor Stock in `floor_material_balance`, and an append-only normalized `stock_activity_log`. Domain endpoints mutate balances, source entries, and activity events in one transaction; React pages consume server-returned impact receipts and never infer authoritative closing balances.

**Tech Stack:** Python 3 / FastAPI / asyncpg, PostgreSQL, React 19, Vite 7, Tailwind CSS 4, Node test runner, pytest/pytest-asyncio.

**Spec:** `docs/superpowers/specs/2026-10-06-two-location-stock-ledger-design.md`

## Global Constraints

- `raw_material_totals` means Warehouse Stock; `floor_material_balance` means independent Floor Stock.
- A floor transfer subtracts Warehouse Stock and adds the identical quantity to Floor Stock; Plant Total is unchanged.
- Production subtracts only Floor Stock; it must not subtract Warehouse Stock again.
- `machine_stock_assignments` remains a derived read model of Floor Stock.
- Every stock mutation writes one append-only activity event in the same transaction.
- Entry edit/delete actions remain on Raw Material, Material To Floor, Production Log, and Wastage; Stock Activity is read-only.
- Workers may modify only entries they created; owners may modify all otherwise-reversible entries.
- Existing zero balances remain zero; the migration must not replay historical transfers into stock.
- Existing API response fields remain available; receipts are additive compatibility fields.
- Production deployment is read-first, backed up, restore-tested, reversible, and verified through loopback plus public HTTPS.

## Review Focus

- Two concurrent warehouse transfers totaling more than availability: exactly one may overdraw; Task 3 adds a serialized-row-lock test.
- A transfer edited or deleted after part of its floor quantity was consumed: reject atomically and explain remaining reversible quantity; Task 3 tests this case.
- A worker attempting to alter another worker's entry by calling the API directly: return HTTP 403 without touching balances; Task 5 tests authorization before mutation.
- A production update changing both material and net weight: restore the original material's exact recorded consumption before taking the new material's quantity; Task 4 tests both legs.
- Legacy rows with missing `material_type_id`: show them as legacy activity but never fabricate a balance reversal; Tasks 1 and 5 test backfill and response status.

---

## File Structure

### Create

- `migrations/007_two_location_stock_ledger.sql` — additive schema, constraints, permissions, zero-safe initialization, and legacy activity backfill.
- `tests/test_two_location_stock.py` — fake-connection unit tests for transfer, consumption, edit, reversal, locking, and activity atomicity.
- `tests/test_stock_activity_api.py` — activity normalization and authorization tests.
- `tests/stockLedger.test.mjs` — receipt-preview and delete-impact copy tests.
- `src/utils/stockLedger.js` — pure receipt formatting and preview calculations.
- `src/components/StockImpactReceipt.jsx` — persistent opening/change/closing receipt.
- `src/pages/StockActivity.jsx` — unified read-only activity page.
- `ops/stock-ledger/verify.sql` — database invariants for candidate and production.
- `ops/stock-ledger/README.md` — exact backup, restore-test, deploy, verification, and rollback commands.

### Modify

- `server.py` — independent balance helpers, domain transactions, activity writer/API, ownership enforcement, additive receipts.
- `migrations/006_full_operational_reset.sql` — include `stock_activity_log` in future full resets without changing preserved masters.
- `tests/test_reset_contract.py` — require activity data to reset and stock tables to remain zero.
- `src/pages/MaterialMovement.jsx` — warehouse/floor previews, persistent receipt, and local editable transfer entries.
- `src/pages/RawMaterial.jsx` — input receipt and reversal-impact copy for local entries.
- `src/pages/Production.jsx` — floor usage preview, receipt, and explicit stock-impact edit/delete dialogs.
- `src/pages/Wastage.jsx` — local entry actions and stock-impact messaging using the domain receipt.
- `src/components/EditEntryModal.jsx` — optional impact summary slot used by all source pages.
- `src/components/DataTable.jsx` — entry/activity badge and non-destructive row-link support; preserve existing action API.
- `src/utils/logActions.js` — domain action functions return impact receipts.
- `src/App.jsx` — route `/stock-activity` for owner and worker.
- `src/components/Sidebar.jsx` — one `Stock Activity` navigation item; remove ambiguous log naming.
- `src/utils/api.js` — preserve additive receipt/activity fields through endpoint transformations.
- `package.json` — keep current test command and include all `tests/*.test.mjs`; no new runtime dependency.

---

### Task 1: Add the append-only ledger schema and zero-safe migration

**Files:**
- Create: `migrations/007_two_location_stock_ledger.sql`
- Modify: `migrations/006_full_operational_reset.sql`
- Modify: `tests/test_reset_contract.py`
- Create: `ops/stock-ledger/verify.sql`

**Interfaces:**
- Produces: table `stock_activity_log`; check constraints for supported `action` and `source_domain`; indexes on `(occurred_at DESC)`, `(material_id, occurred_at DESC)`, and `(source_domain, source_id)`.
- Produces: SQL invariant file returning zero negative balances, zero machine/floor drift, and activity/source referential summaries.

- [ ] **Step 1: Write the failing reset/schema contract tests**

Extend `OPERATIONAL_TABLES` with `stock_activity_log` and add a source-text contract test:

```python
def test_two_location_migration_is_additive_and_zero_safe(self):
    migration = open("migrations/007_two_location_stock_ledger.sql", encoding="utf-8").read()
    self.assertIn("CREATE TABLE IF NOT EXISTS stock_activity_log", migration)
    self.assertNotIn("UPDATE floor_material_balance SET total_quantity_kg = raw", migration)
    self.assertIn("CHECK (warehouse_closing_kg >= 0)", migration)
    self.assertIn("CHECK (floor_closing_kg >= 0)", migration)
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `python -m pytest tests/test_reset_contract.py -q`

Expected: FAIL because migration 007 and `stock_activity_log` reset coverage do not exist.

- [ ] **Step 3: Implement migration 007**

Create the table with exact normalized fields:

```sql
CREATE TABLE IF NOT EXISTS stock_activity_log (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'REVERSE', 'LEGACY')),
    source_domain TEXT NOT NULL CHECK (source_domain IN (
        'RAW_INPUT', 'FLOOR_TRANSFER', 'PRODUCTION', 'WASTAGE', 'MANUAL_ADJUSTMENT'
    )),
    source_id BIGINT,
    correlation_id UUID NOT NULL,
    reverses_activity_id BIGINT REFERENCES stock_activity_log(id),
    material_id BIGINT REFERENCES materials_master(id),
    material_type_id BIGINT REFERENCES material_types(id),
    quantity_kg NUMERIC NOT NULL CHECK (quantity_kg >= 0),
    warehouse_opening_kg NUMERIC CHECK (warehouse_opening_kg >= 0),
    warehouse_delta_kg NUMERIC,
    warehouse_closing_kg NUMERIC CHECK (warehouse_closing_kg >= 0),
    floor_opening_kg NUMERIC CHECK (floor_opening_kg >= 0),
    floor_delta_kg NUMERIC,
    floor_closing_kg NUMERIC CHECK (floor_closing_kg >= 0),
    plant_opening_kg NUMERIC CHECK (plant_opening_kg >= 0),
    plant_delta_kg NUMERIC,
    plant_closing_kg NUMERIC CHECK (plant_closing_kg >= 0),
    reason TEXT,
    created_by BIGINT REFERENCES users(id),
    occurred_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);
```

Grant the production database owner `SELECT, INSERT` and sequence usage. Backfill current rows as `LEGACY` without modifying any balance and use deterministic correlation UUIDs generated from source domain/id through PostgreSQL `md5` casting.

Add entry ownership columns required by the permission contract:

```sql
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
ALTER TABLE wastage_data ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id);
```

- [ ] **Step 4: Add verification SQL and reset coverage**

`ops/stock-ledger/verify.sql` must fail under `ON_ERROR_STOP` if any balance is negative or machine assignments differ from the matching floor balance. Add `stock_activity_log` to migration 006's operational `TRUNCATE ... RESTART IDENTITY` list.

- [ ] **Step 5: Run migration contract tests and verify GREEN**

Run: `python -m pytest tests/test_reset_contract.py -q`

Expected: PASS; integration-only reset tests remain skipped unless `VP_TEST_DB` is set.

- [ ] **Step 6: Commit**

```bash
git add migrations/006_full_operational_reset.sql migrations/007_two_location_stock_ledger.sql tests/test_reset_contract.py ops/stock-ledger/verify.sql
git commit -m "feat: add append-only stock activity schema"
```

---

### Task 2: Build transaction-safe balance and activity primitives

**Files:**
- Create: `tests/test_two_location_stock.py`
- Modify: `server.py:620-793`

**Interfaces:**
- Produces: `lock_stock_locations(conn, material_id: int, material_type_id: int) -> dict`.
- Produces: `apply_location_delta(conn, *, material_id: int, material_type_id: int, warehouse_delta: float, floor_delta: float) -> dict` returning opening/closing warehouse, floor, and plant totals.
- Produces: `record_stock_activity(conn, *, action: str, source_domain: str, source_id: int | None, correlation_id: UUID, material_id: int, material_type_id: int | None, quantity_kg: float, balances: dict, reason: str | None, created_by: int, reverses_activity_id: int | None = None) -> dict`.

- [ ] **Step 1: Write failing primitive tests with a stateful fake connection**

```python
@pytest.mark.asyncio
async def test_location_delta_moves_stock_without_changing_plant_total():
    conn = LedgerFakeConnection(warehouse=Decimal("500"), floor=Decimal("50"))
    receipt = await apply_location_delta(
        conn, material_id=7, material_type_id=3,
        warehouse_delta=-Decimal("100"), floor_delta=Decimal("100"),
    )
    assert receipt == {
        "warehouse_opening_kg": 500.0, "warehouse_closing_kg": 400.0,
        "floor_opening_kg": 50.0, "floor_closing_kg": 150.0,
        "plant_opening_kg": 550.0, "plant_closing_kg": 550.0,
    }
```

Also test warehouse overdraw, floor overdraw, activity insert failure, and consistent lock order.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `python -m pytest tests/test_two_location_stock.py -q`

Expected: collection/import failure because the three functions do not exist.

- [ ] **Step 3: Implement the minimal primitives**

Lock `raw_material_totals` by `material_id` first, then `floor_material_balance` by `material_type_id`, both `FOR UPDATE`. Reject negative closing values before issuing updates. Update each table directly, then call `sync_machine_assignments` once for the affected floor material. Require `conn.is_in_transaction()`.

Insert activity with `RETURNING *`; do not catch insertion exceptions so the outer transaction rolls back balances.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `python -m pytest tests/test_two_location_stock.py -q`

Expected: all primitive tests PASS.

- [ ] **Step 5: Run existing backend tests**

Run: `python -m pytest tests/test_stock_adjustments.py tests/test_two_location_stock.py -q`

Expected: PASS with no regression in owner/admin manual adjustments.

- [ ] **Step 6: Commit**

```bash
git add server.py tests/test_two_location_stock.py
git commit -m "feat: add atomic warehouse and floor balance primitives"
```

---

### Task 3: Make floor transfers move stock and make edit/delete exact reversals

**Files:**
- Modify: `server.py:795-826,1210-1396`
- Modify: `tests/test_two_location_stock.py`

**Interfaces:**
- Consumes: `apply_location_delta`, `record_stock_activity` from Task 2.
- Produces: `apply_floor_transfer(conn, *, source_id, material_id, material_type_id, quantity_kg, created_by, correlation_id) -> dict`.
- Produces: `reverse_floor_transfer(conn, movement_row: dict, created_by: int) -> dict`.
- Endpoint receipts: `POST/PUT/DELETE /floor/transactions` and `POST /materials/move` return `impact_receipt` plus `activity_id`.

- [ ] **Step 1: Write failing floor-transfer tests**

```python
@pytest.mark.asyncio
async def test_floor_transfer_decreases_warehouse_and_increases_floor(monkeypatch):
    conn = LedgerFakeConnection(warehouse=500, floor=50)
    result = await apply_floor_transfer(
        conn, source_id=12, material_id=7, material_type_id=3,
        quantity_kg=100, created_by=9, correlation_id=UUID(int=12),
    )
    assert conn.warehouse == Decimal("400")
    assert conn.floor == Decimal("150")
    assert result["plant_closing_kg"] == 550.0
    assert conn.activity_rows[-1]["source_domain"] == "FLOOR_TRANSFER"
```

Add tests that edit `100 → 60` applies a net `+40 warehouse/-40 floor`, delete restores the exact original transfer, partial downstream consumption blocks reversal, and two concurrent 70 kg transfers from 100 kg cannot both succeed.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `python -m pytest tests/test_two_location_stock.py -k "floor_transfer or concurrent" -q`

Expected: FAIL because current `FLOOR_TRANSFER` only mirrors raw stock and creates no receipt/activity.

- [ ] **Step 3: Implement create/update/delete transaction flow**

Replace the `FLOOR_TRANSFER` no-op in `apply_movement_effect`. Ensure new rows persist `material_type_id` and `created_by`. For edit, lock the movement, restore its original warehouse/floor delta, then apply the replacement transfer before updating the row. For delete, reverse before deleting the active row. Append `UPDATE`/`REVERSE` activity events linked to the original activity id.

Enforce reversal availability with `floor_closing >= 0`; return HTTP 400 text such as `Cannot delete this transfer: only 40.000 kg of its 100.000 kg remains on the floor; 60.000 kg has already been used.`

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `python -m pytest tests/test_two_location_stock.py -k "floor_transfer or concurrent" -q`

Expected: PASS.

- [ ] **Step 5: Run all backend unit tests**

Run: `python -m pytest tests/test_stock_adjustments.py tests/test_two_location_stock.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server.py tests/test_two_location_stock.py
git commit -m "fix: make floor transfers move warehouse stock"
```

---

### Task 4: Consume only Floor Stock from production and preserve exact reversals

**Files:**
- Modify: `server.py:847-921,1401-1650`
- Modify: `tests/test_two_location_stock.py`

**Interfaces:**
- Consumes: locked location helpers and activity writer.
- Produces: `apply_production_consumption(conn, *, log_id, material_id, material_type_id, net_kg, machine_id, created_by, correlation_id) -> dict`.
- Produces: `reverse_production_consumption(conn, log_id: int, created_by: int) -> dict`.
- Endpoint receipts: production create/update/delete return `stock_receipt` and `activity_id`.

- [ ] **Step 1: Write failing production accounting tests**

```python
@pytest.mark.asyncio
async def test_production_uses_floor_without_second_warehouse_deduction():
    conn = LedgerFakeConnection(warehouse=400, floor=150)
    receipt = await apply_production_consumption(
        conn, log_id=21, material_id=7, material_type_id=3,
        net_kg=30, machine_id=1, created_by=9, correlation_id=UUID(int=21),
    )
    assert conn.warehouse == Decimal("400")
    assert conn.floor == Decimal("120")
    assert receipt["plant_opening_kg"] == 550.0
    assert receipt["plant_closing_kg"] == 520.0
```

Add tests for insufficient floor stock, deletion restoring 30 kg, and an update from material A/30 kg to material B/20 kg restoring A before consuming B.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `python -m pytest tests/test_two_location_stock.py -k production -q`

Expected: FAIL because `adjust_floor_balance` currently delegates to `adjust_raw_total` and subtracts Warehouse Stock.

- [ ] **Step 3: Implement production-only floor mutations**

Change production creation to decrement only the locked Floor Stock row, resync machine assignment rows, insert/update the linked `CONSUMPTION` movement, and append `PRODUCTION/CREATE` activity. Update and delete use the movement's recorded `quantity_kg` and `material_type_id`; they never recompute the old effect from edited form fields.

Write the authenticated user id to the migration-007 `production_logs.created_by` column for every new production entry.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `python -m pytest tests/test_two_location_stock.py -k production -q`

Expected: PASS.

- [ ] **Step 5: Run the backend suite**

Run: `python -m pytest -q`

Expected: all unit tests PASS; database integration tests may be skipped only when their documented environment variables are absent.

- [ ] **Step 6: Commit**

```bash
git add server.py tests/test_two_location_stock.py migrations/007_two_location_stock_ledger.sql
git commit -m "fix: consume production from floor stock only"
```

---

### Task 5: Add consolidated activity API and entry ownership enforcement

**Files:**
- Create: `tests/test_stock_activity_api.py`
- Modify: `server.py`

**Interfaces:**
- Produces: `can_modify_entry(user: dict, created_by: int | None) -> bool`.
- Produces: `GET /stock/activity?date_from=&date_to=&material_id=&source_domain=&action=&operator_id=&limit=&offset=`.
- Produces normalized activity rows with `id`, `action`, `action_label`, `source_domain`, `source_id`, `material_name`, `quantity_kg`, opening/delta/closing values, `created_by_name`, `occurred_at`, `is_legacy`, and `entry_path`.

- [ ] **Step 1: Write failing API normalization and authorization tests**

```python
def test_worker_cannot_modify_another_workers_entry():
    assert can_modify_entry({"id": 9, "role": "worker"}, created_by=10) is False

def test_owner_can_modify_any_reversible_entry():
    assert can_modify_entry({"id": 1, "role": "owner"}, created_by=10) is True

def test_activity_row_maps_production_to_source_page():
    row = normalize_activity_row({"source_domain": "PRODUCTION", "source_id": 21, "action": "REVERSE"})
    assert row["entry_path"] == "/production-log"
    assert row["action_label"] == "Production reversed"
```

Also test legacy rows have `is_legacy=True`, activity pagination limit caps at 1000, and filter values are parameterized.

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m pytest tests/test_stock_activity_api.py -q`

Expected: import failure because helpers and endpoint do not exist.

- [ ] **Step 3: Implement authorization before database mutation**

Owners/admins pass; workers pass only when `created_by == user.id`. Apply this check to floor-transfer, production, and wastage update/delete endpoints before balance helpers run. Raw Material remains owner-only because its route is owner-only.

- [ ] **Step 4: Implement normalized read-only activity endpoint**

Build a parameterized query against `stock_activity_log`, join material/user names, calculate labels in `normalize_activity_row`, and return pagination metadata. Do not implement PUT/DELETE routes for activity.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `python -m pytest tests/test_stock_activity_api.py -q`

Expected: PASS.

- [ ] **Step 6: Run complete backend tests**

Run: `python -m pytest -q`

Expected: PASS with only documented integration skips.

- [ ] **Step 7: Commit**

```bash
git add server.py tests/test_stock_activity_api.py
git commit -m "feat: expose immutable stock activity stream"
```

---

### Task 6: Add receipt utilities and persistent impact component

**Files:**
- Create: `src/utils/stockLedger.js`
- Create: `src/components/StockImpactReceipt.jsx`
- Create: `tests/stockLedger.test.mjs`
- Modify: `src/components/EditEntryModal.jsx`

**Interfaces:**
- Produces: `previewFloorTransfer({ warehouseKg, floorKg, quantityKg })`.
- Produces: `previewProductionUsage({ floorKg, quantityKg })`.
- Produces: `describeEntryReversal({ sourceDomain, materialName, quantityKg, receipt })`.
- Produces: `<StockImpactReceipt receipt={...} title="..." onDismiss={...} />`.

- [ ] **Step 1: Write failing pure-JavaScript tests**

```javascript
test('floor transfer preview preserves plant total', () => {
  assert.deepEqual(
    previewFloorTransfer({ warehouseKg: 500, floorKg: 50, quantityKg: 100 }),
    { warehouseOpeningKg: 500, warehouseClosingKg: 400, floorOpeningKg: 50, floorClosingKg: 150, plantOpeningKg: 550, plantClosingKg: 550 },
  )
})

test('production delete copy names the exact restoration', () => {
  assert.equal(
    describeEntryReversal({ sourceDomain: 'PRODUCTION', materialName: 'OPALENE', quantityKg: 30 }),
    'Delete this production entry? 30.00 kg of OPALENE will be restored to Floor Stock. The reversal will remain visible in Stock Activity.',
  )
})
```

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `npm test`

Expected: FAIL because `src/utils/stockLedger.js` does not exist.

- [ ] **Step 3: Implement pure helpers and receipt component**

Helpers coerce only finite non-negative numbers and return `{ error }` for an overdraw preview. `StockImpactReceipt` renders Warehouse, Floor, and Plant rows with textual `Opening`, `Change`, and `Closing` labels; color is supplementary only.

Add an `impactSummary` prop to `EditEntryModal`; render it above Save/Delete confirmation without changing existing callers.

- [ ] **Step 4: Run frontend tests and verify GREEN**

Run: `npm test`

Expected: all Node tests PASS.

- [ ] **Step 5: Run changed-file lint**

Run: `npx eslint src/utils/stockLedger.js src/components/StockImpactReceipt.jsx src/components/EditEntryModal.jsx`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/stockLedger.js src/components/StockImpactReceipt.jsx src/components/EditEntryModal.jsx tests/stockLedger.test.mjs
git commit -m "feat: add clear stock impact receipts"
```

---

### Task 7: Put editable entries and balance impact on every source page

**Files:**
- Modify: `src/pages/MaterialMovement.jsx`
- Modify: `src/pages/RawMaterial.jsx`
- Modify: `src/pages/Production.jsx`
- Modify: `src/pages/Wastage.jsx`
- Modify: `src/utils/logActions.js`
- Modify: `src/utils/api.js`
- Modify: `src/components/DataTable.jsx`
- Modify: `tests/stockLedger.test.mjs`

**Interfaces:**
- Consumes: receipt helpers/component from Task 6 and additive backend receipts from Tasks 3-5.
- Produces: each source page has a local `Entries` table with domain-safe edit/delete callbacks and a persistent last-action receipt.

- [ ] **Step 1: Add failing copy/normalization tests for local entries**

Test that API receipt snake_case fields survive transformation, `entry` badges are distinct from `activity` badges, and deletion copy never says only `Delete transaction?`.

```javascript
test('receipt normalization preserves authoritative closing balances', () => {
  assert.deepEqual(normalizeImpactReceipt({ warehouse_closing_kg: 400, floor_closing_kg: 150 }), {
    warehouseClosingKg: 400,
    floorClosingKg: 150,
  })
})
```

- [ ] **Step 2: Run `npm test` and verify RED**

Expected: FAIL until normalization and badges exist.

- [ ] **Step 3: Upgrade Material To Floor**

Show `Warehouse before - Sent = Warehouse after` and `Floor before + Received = Floor after` before submit. Wire the existing `/floor/transactions` edit/delete endpoints into the page's existing history table. Use server `impact_receipt` after mutation, refetch both location balances, and show the exact reversal confirmation returned by `describeEntryReversal`.

- [ ] **Step 4: Upgrade Raw Material, Production, and Wastage**

Keep each page's input form and entries together. Add persistent receipts after create/edit/delete. Production button copy becomes `Log Production & Use Stock`; selected material shows `Floor available - Using now = Floor remaining`. Under the current domain contract, Wastage is reporting-only: its entry and activity row explicitly show `No warehouse or floor stock change`, with zero location deltas. No extra stock deduction is invented for wastage.

- [ ] **Step 5: Enforce role-aware controls without relying on them for security**

Pass authenticated user id/role to row action predicates. Workers see edit/delete only on their own entries; owner sees all reversible entries. Legacy rows show `Legacy record — no automatic reversal` and no destructive control.

- [ ] **Step 6: Run frontend tests and verify GREEN**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: Run lint and production build**

Run: `npm run lint`

Expected: zero ESLint errors.

Run: `npm run build`

Expected: Vite production build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/pages/MaterialMovement.jsx src/pages/RawMaterial.jsx src/pages/Production.jsx src/pages/Wastage.jsx src/utils/logActions.js src/utils/api.js src/components/DataTable.jsx tests/stockLedger.test.mjs
git commit -m "feat: keep editable stock entries on source pages"
```

---

### Task 8: Replace ambiguous Log History with unified read-only Stock Activity

**Files:**
- Create: `src/pages/StockActivity.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`
- Modify: `src/pages/LogHistory.jsx` (remove route usage; retain only if another import remains)
- Modify: `src/components/DataTable.jsx`
- Modify: `tests/stockLedger.test.mjs`

**Interfaces:**
- Consumes: `GET /stock/activity` normalized rows.
- Produces: `/stock-activity` route for owner and worker; date/material/source/action filters; read-only export; `View Entry` navigation with `flashDate`/entry id state.

- [ ] **Step 1: Add failing activity presentation tests**

```javascript
test('activity actions never expose destructive controls', () => {
  const actions = activityRowActions({ entryPath: '/production-log', sourceId: 21 })
  assert.deepEqual(actions.map((action) => action.label), ['View Entry'])
})
```

Test filter serialization and labels for Received, Moved to Floor, Used in Production, Corrected, Reversed, and Legacy.

- [ ] **Step 2: Run `npm test` and verify RED**

Expected: FAIL because Stock Activity helpers/page do not exist.

- [ ] **Step 3: Implement Stock Activity page**

Fetch `/stock/activity` with server-side filters and pagination. Render date-grouped rows showing source/action badges, material, operator, `Opening → Change → Closing`, location, and linked reversal. Export the same normalized rows. Provide `View Entry` only when `entry_path` and active `source_id` exist. Do not pass `onEdit`, `onDelete`, or bulk-selection props to `DataTable`.

- [ ] **Step 4: Route and navigation**

Import `StockActivity` in `App.jsx`; add protected `/stock-activity` for owner and worker. Add one sidebar item named `Stock Activity`. Remove any user-visible `Log History` item/route to prevent duplicate meanings.

- [ ] **Step 5: Run tests, lint, and build**

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/StockActivity.jsx src/pages/LogHistory.jsx src/App.jsx src/components/Sidebar.jsx src/components/DataTable.jsx tests/stockLedger.test.mjs
git commit -m "feat: unify immutable stock activity in one page"
```

---

### Task 9: Verify end-to-end accounting and document reversible rollout

**Files:**
- Create: `ops/stock-ledger/README.md`
- Modify: `ops/stock-ledger/verify.sql`
- Modify: `tests/test_two_location_stock.py`
- Modify: `tests/test_stock_activity_api.py`

**Interfaces:**
- Consumes all previous tasks.
- Produces a documented receive → transfer → consume → edit/delete → audit verification sequence and exact rollback procedure.

- [ ] **Step 1: Add the final regression matrix**

Add a test that starts Warehouse 500/Floor 50, transfers 100, consumes 30, deletes production, then deletes transfer. Assert states in sequence:

```python
assert states == [
    (400, 150, 550),
    (400, 120, 520),
    (400, 150, 550),
    (500, 50, 550),
]
assert [row["action"] for row in conn.activity_rows] == ["CREATE", "CREATE", "REVERSE", "REVERSE"]
```

- [ ] **Step 2: Run the full local verification suite**

Run: `python -m pytest -q`

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Expected: every command exits 0; only explicitly environment-gated database integration tests may be skipped.

- [ ] **Step 3: Write the production runbook**

Document these exact gates:

1. Verify `/root/backend/server.py` is authoritative under PM2 `vp-api` and hash-match it to reviewed source.
2. Query warehouse/floor/machine totals, movement counts, production coverage, and activity table state without mutation.
3. Create a timestamped root-only PostgreSQL/source/environment bundle with SHA-256.
4. Restore the bundle into a temporary database owned by the production owner and run `verify.sql` plus an API-start smoke test.
5. Stop `vp-api`, apply migration 007 with `psql -X -v ON_ERROR_STOP=1`, deploy backend, and restart.
6. Run the accounting smoke matrix on the restore candidate first; on production use a designated disposable test material and reverse every smoke entry before proceeding.
7. Deploy the reviewed frontend commit.
8. Verify loopback API root, public API, public frontend, SSE refresh, and both owner/worker UI flows.
9. If any invariant fails, stop writes, restore the bundle, restart `vp-api`, and re-run zero/health checks.

- [ ] **Step 4: Run `git diff --check` and inspect intended files only**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only plan-owned files are modified. Preserve the user's untracked `AGENTS.md`.

- [ ] **Step 5: Commit**

```bash
git add ops/stock-ledger/README.md ops/stock-ledger/verify.sql tests/test_two_location_stock.py tests/test_stock_activity_api.py
git commit -m "docs: add reversible stock ledger rollout"
```

---

### Task 10: Execute controlled production deployment and verify live behavior

**Files:**
- No new source files; use reviewed commits and `ops/stock-ledger/README.md`.

**Interfaces:**
- Consumes: migration 007, backend/frontend build, verification SQL, runbook.
- Produces: one verified rollback bundle, deployed hashes, live accounting smoke evidence, and public health evidence.

- [ ] **Step 1: Record live preflight evidence**

Run the runbook's read-only inventory. Abort if the live source hash, database owner, schema, or current balance assumptions differ from the reviewed candidate.

- [ ] **Step 2: Create and restore-test the rollback bundle**

Require SHA-256 success, `pg_restore --list` success, full temporary-database restore, application-role read/write smoke, and `verify.sql` success before mutation.

- [ ] **Step 3: Apply the migration and backend cutover**

Stop `vp-api`, apply migration 007 with `ON_ERROR_STOP`, deploy the reviewed backend hash, restart, and verify loopback health before reopening UI writes.

- [ ] **Step 4: Run controlled accounting smoke**

Use the designated test material to receive 10 kg, transfer 4 kg, consume 1 kg, delete consumption, and delete transfer. Verify each API receipt, database balance, activity event, and final restoration to 10 kg; then delete/reverse the test receipt so the pre-smoke state is restored.

- [ ] **Step 5: Deploy frontend and verify user workflows**

Verify as owner and worker:

- source pages show entries locally;
- workers cannot edit another worker's entry;
- transfer and production previews match API closing balances;
- delete dialogs state exact reversal effects;
- Stock Activity shows all create/reverse events and no delete controls;
- public API and frontend return HTTP 200.

- [ ] **Step 6: Record final evidence**

Add a dated verification record under `docs/superpowers/` containing deployed commit hashes, migration result, backup path/hash, smoke receipts, final balances, PM2 status, and public status codes. Commit it with:

```bash
git add docs/superpowers/*stock-ledger*verification*.md
git commit -m "docs: record stock ledger production verification"
```
