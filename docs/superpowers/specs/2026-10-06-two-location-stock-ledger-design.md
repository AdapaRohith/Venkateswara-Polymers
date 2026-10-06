# Two-Location Stock Ledger Design

Date: 2026-10-06
Project: Venkateswara Polymers IMS
Status: Revised after user clarification; implementation pending final review

## Purpose

Make stock decrease at the stage operators understand as usage while preserving an exact explanation of where every kilogram went. Warehouse stock, floor stock, and consumed stock must be distinct, auditable states. A transfer must never disappear stock, and production must never deduct the same quantity twice.

The interface must also separate two concepts that currently look interchangeable:

- **Entries** are the operational records users create. They appear on the same page as the input form and can be edited or deleted through the correct domain action.
- **Activity Log** is the permanent proof of every stock change, edit, and reversal. It is consolidated on one page and is never directly editable or deletable.

Deleting an entry must reverse the stock effect transactionally and add a reversal event to the Activity Log. Deleting an Activity Log row is not a supported user action.

## Current Problem and Evidence

`raw_material_totals` is currently treated as the plant-wide balance. `floor_material_balance` and `machine_stock_assignments` are copied from it rather than representing a separate location. A `FLOOR_TRANSFER` is deliberately implemented as a no-op on quantity, so the Material To Floor screen records history without reducing warehouse stock.

On the live database on 2026-10-06, ten `FLOOR_TRANSFER` rows totaling 1,525 kg existed while no production logs or consumption movements existed. This proves the reported symptom is caused by the current accounting contract, not a delayed refresh.

## Selected Accounting Model

### Stock locations

- `raw_material_totals` is Warehouse Stock: material physically available in the warehouse.
- `floor_material_balance` is Floor Stock: material issued to production but not yet consumed.
- `machine_stock_assignments` is a read model derived from Floor Stock for each machine; it is never independently incremented or decremented.
- `material_movements` is the immutable operational receipt tying every balance change to its origin.

### Movement rules

| Operation | Warehouse | Floor | Ledger |
|---|---:|---:|---|
| Receive raw material | `+quantity` | unchanged | receipt/batch history |
| Send To Floor | `-quantity` | `+quantity` | `FLOOR_TRANSFER`, `OUT` |
| Log production | unchanged | `-net weight` | `CONSUMPTION`, `OUT`, linked to production log |
| Delete Send To Floor | `+original quantity` | `-original quantity` | original movement removed only after successful reversal |
| Delete production log | unchanged | `+recorded consumption` | linked consumption removed only after successful reversal |
| Edit production log | restore old floor usage, then apply new usage | exact delta | linked consumption updated |

The plant total is `Warehouse Stock + Floor Stock`. A floor transfer changes location, not the plant total. Production consumption reduces the plant total exactly once.

## Backend Design

### Permanent stock activity log

Add an append-only `stock_activity_log` table. Every stock-changing transaction writes one activity event inside the same database transaction as the balance change. Required fields include:

- event id and timestamp;
- event action (`CREATE`, `UPDATE`, `REVERSE`);
- source domain and source id (`RAW_INPUT`, `FLOOR_TRANSFER`, `PRODUCTION`, `WASTAGE`, `MANUAL_ADJUSTMENT`);
- material identity and user identity;
- warehouse delta plus opening/closing balances;
- floor delta plus opening/closing balances;
- plant-total delta plus opening/closing balances;
- human-readable reason or note;
- correlation id linking an edit/reversal to the original entry.

No application endpoint deletes or mutates activity rows. Corrections append an `UPDATE` or `REVERSE` event. This gives operators one reliable place to prove that stock was received, moved, consumed, corrected, or restored.

`GET /stock/activity` returns a normalized, paginated stream with date, material, event type, source page, quantity, location changes, resulting balances, operator, and reversal status. Filters cover date, material, source domain, action, and operator.

### Transactional transfer

`POST /materials/move` for `FLOOR_TRANSFER` will:

1. Resolve both the warehouse material and corresponding floor material type.
2. Lock the warehouse and floor balance rows in a consistent order.
3. Reject quantities greater than warehouse availability.
4. Capture warehouse and floor opening balances.
5. Decrease warehouse and increase floor within the same database transaction.
6. Insert the movement with both `material_id` and `material_type_id`.
7. Rebuild machine assignment rows from the new Floor Stock.
8. Return an authoritative balance receipt.

The response receipt contains material identity, quantity moved, warehouse opening/closing balances, floor opening/closing balances, and plant total before/after.

Creating, updating, and deleting a transfer each append the matching activity event. A delete endpoint reverses the transfer first and only then removes it from the active-entry list. If downstream production has already consumed the floor quantity, deletion is blocked with an explanation telling the user how much remains and why the original transfer cannot be fully reversed.

### Production consumption

Production creation will lock Floor Stock, reject insufficient floor availability, subtract the production net weight only from Floor Stock, and write the linked `CONSUMPTION` movement in the same transaction. It will not modify Warehouse Stock.

Production responses will include quantity used and floor opening/closing balances. Update and delete paths continue to use the recorded consumption movement as the reversal source so they never recompute historical usage from mutable fields.

Creating, updating, and deleting a production entry append matching activity events. Deleting a production entry restores its recorded floor consumption and writes a `REVERSE` event, so the central Activity Log explicitly explains why stock increased.

### Reversal safety

- A floor-transfer reversal is rejected if the floor no longer contains the transferred quantity; stock already consumed cannot be silently returned to the warehouse.
- All checks, balance mutations, and ledger changes occur in one transaction.
- Concurrent transfers and consumption serialize on balance rows.
- Negative warehouse and floor balances are rejected.
- API errors name the material, attempted quantity, and available quantity.

### Compatibility and migration

The migration changes `floor_material_balance` from a raw-stock mirror to an independent balance and adds any indexes or constraints needed for the ledger. It does not replay the ten historical floor transfers or create stock from them: the user explicitly cleared current stock, and all current warehouse/floor/machine balances are zero. New accounting behavior begins after deployment.

Existing `FLOOR_TRANSFER` rows without `material_type_id` remain reportable historical records but are not reversible through the new balance logic. The UI will label those rows as legacy records if a reversal action is later exposed.

Existing active operational rows are backfilled into `stock_activity_log` as `CREATE` events when their effect can be reconstructed safely. Historical rows whose balance effect is ambiguous are imported with a `LEGACY` status and no invented opening/closing balances. The backfill never changes current stock.

Deployment must be read-first and reversible:

1. Verify live schema, counts, balances, process path, and deployed source hash.
2. Create and restore-test a root-only database/source rollback bundle.
3. Apply the additive migration and backend while writes are paused or the service is stopped briefly.
4. Run a controlled receive → transfer → consume → reverse smoke test inside a disposable material/test transaction or restore candidate.
5. Deploy the frontend only after backend verification.
6. Verify loopback API, public API, and public frontend.

## Frontend Design

### Entry and log terminology

The word **Entry** is used for records users can change. The word **Activity** is used for permanent audit evidence. Generic labels such as “Log History” and generic delete confirmations are removed.

Every editable row has a visible `Entry` badge. Every activity row has a visible action badge such as `Received`, `Moved to Floor`, `Used in Production`, `Corrected`, or `Reversed`.

Before deleting an entry, the confirmation dialog states the exact balance effect, for example:

> Delete this production entry? 30.00 kg will be restored to Floor Stock. The reversal will remain visible in Stock Activity.

After deletion, the success receipt states the resulting balance. This prevents users from deleting a history-looking row merely to hide it and wondering why stock did or did not change.

### Consolidated Stock Activity page

Replace the existing floor-only `LogHistory` implementation with one routed **Stock Activity** page that shows all normalized events together:

- warehouse inputs;
- warehouse-to-floor transfers;
- production consumption/output;
- wastage affecting stock;
- manual stock adjustments;
- edits and reversals.

The page is read-only, searchable, filterable, grouped by date, and exportable. Each row shows `Opening → Change → Closing`, the affected location, source page, operator, and whether it reversed another event. A `View Entry` action opens the relevant source page and highlights the active entry when it still exists. There are no edit or delete controls on Activity rows.

The page is available to owners and workers, with sensitive administrative fields omitted for workers. Navigation uses the label `Stock Activity`, not `Logs`.

### Entries on their source pages

Every page that creates an input/output record shows its own relevant entries directly below or beside the form:

- **Raw Material:** received-stock entries with edit/delete actions and warehouse balance impact.
- **Material To Floor:** transfer entries with edit/delete actions and warehouse/floor impact.
- **Production Log:** production entries with edit/delete actions and floor-stock impact.
- **Wastage:** wastage entries with edit/delete actions and the appropriate stock impact.

Users do not need to navigate to Stock Activity to correct an entry. After any create, edit, or delete, the local entry list, balance cards, receipt panel, and central activity stream refresh together through authoritative API responses and SSE.

Owners can edit/delete all permitted active entries. Workers can edit/delete only entries they created, subject to downstream-stock reversal checks. The backend enforces ownership; hiding buttons is not treated as authorization.

### Material To Floor

The form will show a live, pre-submit balance preview for the selected material:

`Warehouse before - Sent to floor = Warehouse after`

Below it, the destination preview shows:

`Floor before + Received = Floor after`

After success, a persistent receipt panel and toast will state, for example:

> 125.00 kg moved to Floor. Warehouse: 500.00 → 375.00 kg. Floor: 40.00 → 165.00 kg. Total plant stock remains 540.00 kg.

The stock summary will show Warehouse, Floor, and Total Plant Stock as separate labeled columns. The movement history wording changes from ambiguous “To Floor” alone to a location receipt (`Warehouse → Floor`) with quantity.

### Production Log

For the selected material, the form will show:

`Floor available - Using now = Floor remaining`

The submit button will say `Log Production & Use Stock`. After success, a receipt will state the exact material and floor balance reduction. History rows will retain the production net weight and display a `Floor stock reduced` status.

### Clarity and accessibility

- Use full labels rather than color alone to distinguish Warehouse, Floor, and Used.
- Use tabular numeric formatting and consistent kilograms precision.
- Keep success receipts visible until replaced or dismissed; do not rely only on short-lived toasts.
- On API failure, preserve all entered form values.
- Refresh balances from the authoritative API response/SSE rather than trusting optimistic arithmetic.

## API Contract Additions

Transfer success adds a `balance_receipt` object:

```json
{
  "material_name": "OPALENE",
  "quantity_kg": 125,
  "warehouse_opening_kg": 500,
  "warehouse_closing_kg": 375,
  "floor_opening_kg": 40,
  "floor_closing_kg": 165,
  "plant_opening_kg": 540,
  "plant_closing_kg": 540
}
```

Production success adds a `stock_receipt` object:

```json
{
  "material_name": "OPALENE",
  "quantity_used_kg": 25,
  "floor_opening_kg": 165,
  "floor_closing_kg": 140
}
```

Existing response fields remain available for compatibility.

Entry create/update/delete responses also return the activity event id and an `impact_receipt` used by confirmation dialogs and persistent success receipts. The frontend does not infer reversal effects from labels.

## Testing Strategy

Backend tests are written first and must fail against the current implementation. They cover:

- transfer decreases warehouse and increases floor by the same quantity;
- plant total is unchanged by transfer;
- production decreases floor without decreasing warehouse again;
- insufficient warehouse/floor stock rolls back the complete operation;
- transfer and production reversal restore exact balances;
- editing production restores the old consumption before applying the new one;
- concurrent operations cannot overdraw either location;
- legacy movements without a floor material id cannot fabricate a reversal.
- every successful balance mutation writes exactly one append-only activity event;
- an entry update/reversal preserves the prior activity and adds a linked event;
- workers cannot modify another worker's entries;
- the consolidated activity endpoint normalizes all supported stock domains.

Frontend pure helpers are tested first for preview and receipt calculations. Component/build verification covers visible before/moved/after and before/used/after copy, error preservation, and responsive layout.

Before deployment, run the complete Python test suite, frontend tests, changed-file lint, and production build.

## Acceptance Criteria

1. Sending 100 kg to the floor changes Warehouse `500 → 400`, Floor `50 → 150`, and Plant Total remains `550`.
2. Logging 30 kg production changes Floor `150 → 120`, Warehouse remains `400`, and Plant Total becomes `520`.
3. Every successful action shows an authoritative receipt with opening, change, and closing balances.
4. Movement and production history explain the same changes visible in the balances.
5. Delete/edit operations reverse only quantities previously applied by their own ledger rows.
6. No operation can create a negative balance or partially update one location.
7. Raw Material, Material To Floor, Production Log, and Wastage pages show their own active entries with domain-safe edit/delete actions.
8. Deleting an entry previews and applies the exact reversal, while the immutable reversal remains visible in Stock Activity.
9. Stock Activity shows all input/output stock events on one page and has no destructive actions.
10. Workers can change only their own eligible entries; owners retain broader control.
11. Existing cleared production state remains zero after migration.
12. Live API and frontend remain available after the controlled rollout.

## Rollback

The pre-deployment rollback bundle restores the database, backend, frontend source, environment, and process configuration. If a post-deployment invariant fails, stop writes, restore the bundle, restart `vp-api`, and verify warehouse/floor/machine totals plus public health before reopening the system.
