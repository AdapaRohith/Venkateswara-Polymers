# Stock ledger production verification — 2026-10-08

## Release identity

- Reviewed source commit deployed: `720bdb5` (`codex/two-location-stock-ledger`)
- GitHub production branch after frontend release: `origin/main` at `720bdb5`
- Backend SHA-256: `b213c7dfbf799a0cd71c2ffc33d283cafa444f3c0b4b9e4d69e6e58477c71c7e`
- The authoritative `/root/backend/server.py` and synchronized `/root/Venkateswara-Polymers/server.py` matched that hash.
- PM2 `vp-api`: `online`, cwd `/root/backend`, script `/root/backend/venv/bin/uvicorn`
- Live frontend asset containing `/stock-activity`: `/assets/index-CmcyKaw_.js`

## Preflight and rollback proof

- Read-only inventory confirmed database `venkateswara_polymers`, owner `admin`, PM2 path `/root/backend`, and the previous live backend hash before mutation.
- Preflight found the root filesystem at 100%. Only regenerable root package caches (`uv`, `pip`, and npm) were cleared. The filesystem finished at 82% with 8.7 GB free; application data and rollback archives were not removed.
- New root-only rollback/evidence bundle: `/root/backups/vp-stock-ledger-20261008T050942Z`
- Bundle directory mode: `0700`; every file mode: `0600`; owner: `root:root`.
- `SHA256SUMS` passed before cutover. `EVIDENCE-SHA256SUMS` passed after all deployment evidence was sealed.
- PostgreSQL custom dump passed `pg_restore --list`, restored into `vp_stock_restore_20261008T050942Z` with database and new table owned by `admin`, migrated successfully, passed `verify.sql`, and started the candidate API on loopback port 3001.
- The disposable restore database and staged `/tmp` files were removed after successful production verification.

## Accounting proof

Both the restored candidate and live production passed the same API sequence using zero-balance material `LLDPE`:

| Step | Warehouse kg | Floor kg | Plant kg |
| --- | ---: | ---: | ---: |
| Opening | 0 | 0 | 0 |
| Receive 10 | 10 | 0 | 10 |
| Transfer 4 to floor | 6 | 4 | 10 |
| Consume 1 in production | 6 | 3 | 9 |
| Delete production entry | 6 | 4 | 10 |
| Delete floor transfer | 10 | 0 | 10 |
| Delete raw input | 0 | 0 | 0 |

The immutable activity order was:

1. `RAW_INPUT CREATE`
2. `FLOOR_TRANSFER CREATE`
3. `PRODUCTION CREATE`
4. `PRODUCTION REVERSE`
5. `FLOOR_TRANSFER REVERSE`
6. `RAW_INPUT REVERSE`

Production activity IDs were `30` through `35`. Final LLDPE Warehouse and Floor balances were both `0.000` kg. Assignment drift was `0`; the append-only trigger `stock_activity_append_only` was present; and the temporary authorization-test worker count was `0`.

## Live data and authorization

- Warehouse: 31 rows, `11,400.000` kg
- Floor: 21 rows, `9,825.000` kg
- Machine assignment rows: 136, `78,600.000` kg (per-machine mirrors; not a plant-total measure)
- Historical migration evidence: 6 raw inputs, 10 floor transfers, and 13 manual adjustments marked `LEGACY`, so those rows did not replay stock.
- A temporary approved worker was inserted only for a read-only authorization smoke and removed in `finally`:
  - `GET /stock/activity?limit=1` → `200`
  - owner-only `GET /raw-material/adjustments` → `403`
- Owner activity and reversal operations passed through authenticated API smoke.

## Browser and public verification

- Loopback API `/` → `200`
- Public API `https://vp-api.avlokai.com/` → `200`
- Public frontend `https://vp.avlokai.com/` → `200`
- Existing owner browser session was reloaded against the deployed bundle.
- Sidebar showed **Stock Activity**.
- Unified page showed 35 records with date grouping, filters, export, Warehouse/Floor/Plant opening-change-closing columns, linked reversals, and **View Entry** only—no delete controls.
- The six production smoke events were visible with exact `0 → +10 → 10`, `10 → -4 → 6`, and `4 → -1 → 3` effects and their reversals.
- Raw Material showed **ENTRIES — RAW MATERIAL INPUTS** on the same page as the input form and stock totals. Legacy inputs remained read-only as designed; new editable entries use source-page edit/delete controls.
- SSE authentication and initial `connected` event passed in both restore and production smoke.

## Local verification

- `python -m pytest -q`: 34 passed, 4 environment-gated skips
- `npm test`: 17 passed
- ESLint over all JavaScript/JSX changed by this release: passed
- `npm run build`: passed (2,898 modules)
- `git diff --check`: passed
- Repository-wide `npm run lint` remains a pre-existing baseline failure: 3,232 errors and 4 warnings, dominated by generated `.worktrees`/`dist` content and unrelated legacy source. No release-owned lint error remains.
