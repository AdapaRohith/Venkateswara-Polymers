# Full Operational Reset and Audited Stock Adjustment Design

## Intent

Reset Venkateswara Polymers to a clean operational baseline while preserving the identities and configuration needed to resume work. Replace the Raw Material page's add-only total editor with one safe adjustment action that supports adding or removing stock and records opening and closing balances.

## Preserved data

- Users, credentials, roles, and account status.
- Machines and machine definitions.
- Material master records, material types, and name mappings.
- System configuration and deployed application configuration.

## Purged data

- Production logs and production-entry batches.
- Material movements and raw-material receipts/batches.
- Orders, order items, and fulfillment records.
- Production orders and production-order items.
- Trading, wastage, and issue-report history.
- Prior stock-reset log entries and manual-adjustment history.

Raw, floor, and machine stock balances become exactly zero. Current machine-worker state is cleared. Operational sequences restart from their initial values.

## Recovery contract

Before the reset, stop API writes and create one root-only archive containing a PostgreSQL custom-format dump, the current deployed backend and environment, a Git bundle of the frontend repository, a manifest, checksums, and restoration instructions. Verify the dump with `pg_restore --list`, restore it into an isolated temporary database, compare schema and row counts, then drop the temporary database.

Only after the new archive, reset, deployment, and health checks pass may older Venkateswara database and code backup files be removed. The verified archive is the sole retained rollback artifact.

## Stock adjustment model

Add a `stock_adjustments` table containing material, operation (`add` or `remove`), positive quantity, opening quantity, closing quantity, mandatory reason, operator, and timestamp. Records are immutable through the application.

`POST /raw-material/adjust` is owner/admin-only. It validates the request, locks the material total in a database transaction, prevents negative stock, updates the raw total, regenerates floor and machine mirrors, inserts the audit record, and returns the opening and closing quantities.

`GET /raw-material/adjustments` is owner/admin-only and returns recent entries with material and operator names. Opening and closing stock are taken from the immutable adjustment record; no duplicate editable balance columns are introduced.

The existing receipt form remains the path for genuine incoming material batches. Manual corrections use the adjustment action and do not create fake receipt batches.

## Raw Material interface

Each stock-total row has one `Adjust` action. Its dialog shows material and current stock, accepts operation, positive quantity, and required reason, previews the resulting balance, and blocks an excessive removal before submission. After success, totals, batches, material options, and adjustment history refresh.

The page includes an adjustment-history table showing timestamp, material, operation, quantity, opening stock, closing stock, reason, and operator.

## Cutover

1. Build and test locally against the live revision.
2. Restore the production dump to an isolated staging database and run reset/adjustment integration checks there.
3. Stop `vp-api` for the final write freeze.
4. Create and verify the singular backup archive.
5. Apply the schema/reset transaction and deploy the backend.
6. Restart and verify loopback/public health plus database invariants.
7. Publish the frontend from the tested commit and verify the public application.
8. Remove older Venkateswara backups and verify that exactly one rollback archive remains.

If any pre-commit validation fails, restart the unchanged service. If a post-commit validation fails, restore the database and deployed files from the singular archive before reopening writes.

## Acceptance criteria

- All purged operational tables contain zero rows.
- All raw, floor, and machine stock balances are zero.
- Preserved table counts and authentication data remain unchanged.
- Owners/admins can add and remove stock; workers receive `403`.
- Zero, malformed, missing-reason, and excessive-removal requests fail without mutation.
- Successful adjustments atomically update mirrors and create an audit row with exact opening/closing values.
- Backend tests, frontend build, staging restore, production health, and post-reset invariant checks pass.
- Exactly one verified Venkateswara rollback archive remains.
