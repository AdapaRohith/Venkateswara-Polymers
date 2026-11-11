# IPMS: Ground Floor / 1st Floor / Roll Store / Finished Goods

## Stock model

| Store | Holds | Fed by | Drawn by |
| --- | --- | --- | --- |
| Ground Floor (raw material bay) | raw material | receipts | transfers up, extrusion |
| 1st Floor Production (running stock) | raw material, RP REGRIND | transfers, wastage | extrusion (drawn first) |
| Roll Store | film rolls by size | extrusion net | cutting, dispatch |
| Finished Goods Store | cut goods by size | cutting net | dispatch (order fulfillment) |

There is no Warehouse. Raw material is received straight onto a floor.

* **Extrusion** (MCN-1 … MCN-5): materials used (blend lines) must add up to the gross weight.
  Net = gross − wastage goes to the Roll Store as that roll size.
* **Cutting** (CUTTING MCN-1 … 3): consumes rolls from the Roll Store (never resin); net goes to
  Finished Goods. Wastage from either section goes to RP REGRIND on the 1st Floor unless unticked.
* **Dispatch**: supplying an order item takes the goods out of their store.
* **Corrections**: nothing is edited or deleted — an entry is reversed (opposite ledger rows on
  the same business day and shift). A reversal is refused if the stock has already moved on.
* **Stock alert bands**: below 10 t Reorder Warning, 10–20 t Buffer Stock, above 20 t Optimal
  Stock (plant-wide setting, per-material overrides).
* **Ledger**: `stock_ledger` is the truth; `stock_balances` is its running total. `GET /stock/verify`
  must return `ok: true`.
* Shifts: Day (AM) 08:00–20:00, Night (PM) 20:00–08:00 belonging to the day it started.
* 1 bag = 25 kg; everything is stored in kg.

## Reports

* Inventory Register (`/reports/inventory-register[.xlsx]?date=`) — the plant's "Polymer Raw
  Material Inventory Register": consolidated zones, Ground Floor bay, 1st Floor production, plus
  Roll Store and Finished Goods sheets.
* Shift Production Report (`/reports/shift-production[.xlsx]?date=`) — Day/Night × Plant/Cutting,
  gross − wastage = net, day & night totals.
* Production Summary (`/reports/production-summary[.xlsx]?date_from=&date_to=`) — daily, machine-wise,
  material usage, output by size.

## Schema and deploy

`schema.sql` is applied on every API start (idempotent). `migrations/010_fresh_start.sql` dropped
the old Warehouse-model tables and zeroed all figures (Nov 2026).

```bash
cp server.py ipms_logic.py reports_xlsx.py schema.sql /root/backend/ && pm2 restart vp-api
```

Frontend: push `main`; Cloudflare builds and deploys vp.avlokai.com.

## Verification

* `python -m pytest -q tests` — rules (status bands, size codes, register maths, shift report).
* `tests/e2e/api_flow.py` — full receive → move → extrude → cut → dispatch → reverse → count
  scenario against a disposable API + database (refuses production).
