# Full Operational Reset Verification — 2026-10-05

## Deployment

- Production API: `https://vp-api.avlokai.com/`
- Production frontend: `https://vp.avlokai.com/`
- Deployed repository commit: `ce5c01d`
- Verification completed: `2026-10-05T14:44:15Z`
- API process: PM2 `vp-api`, online
- Loopback, public API, and public frontend health: HTTP 200
- Deployed backend SHA-256 matched the reviewed `server.py`: `626b838212207b71c97c464c63e43eb5ff1ef333b8440d2ca2202196c541b2f1`

## Single rollback point

- Archive: `/root/backups/venkateswara-polymers-reset-20261005T125303Z.tar.gz`
- SHA-256: `33382483f32aa61041fa1b9f2c1d1552807a8ae6b21f3bc5f6f4c93e4e1587cc`
- The custom-format PostgreSQL dump was listed and restored into a staging database before cutover.
- Internal bundle checksums, preserved master counts, database-owner metadata, backend files, environment file, Git bundle, and repository commit all verified.
- All older Venkateswara database, source, environment, and reset-script backups were removed after production verification. Only this archive and its checksum remain.

## Reset result

Pre-reset operational records included 4,708 production logs, 3,655 material movements, 209 orders, 163 fulfillment records, 80 raw-material batches, 67 wastage rows, 7 machine production logs, 7 production-entry batches, 4 trading rows, and 3 previous reset-log rows.

Post-reset checks:

- Combined operational rows: `0`
- Raw-material stock: `0.000 kg`
- Floor stock: `0.000 kg`
- Machine stock: `0.000 kg`
- Active machine workers: `0`
- Preserved users: `79`
- Preserved machines: `8`
- Preserved materials: `27`
- Preserved material types: `18`
- Preserved system configuration rows: `2`
- Database owner preserved as `admin`

## Stock-adjustment verification

- Owner add and remove requests succeeded through the candidate API and production API.
- A removal larger than available stock returned HTTP 400.
- A worker adjustment returned HTTP 403.
- Two concurrent 7 kg removals against 10 kg allowed exactly one request, rejected the other, and closed at 3 kg.
- Audit rows recorded opening quantity, closing quantity, operation, reason, operator, and timestamp.
- Production smoke adjustments were removed and all stock mirrors were returned to zero before final verification.
- The public frontend bundle contains the adjustment endpoint, the Adjust Stock form, opening/closing audit language, and the Stock Adjustments table.

## Automated checks

- Backend: 11 passed; 4 database-contract tests skipped locally and passed against the restored staging database.
- Frontend: 6 passed.
- Vite production build passed.
- Changed-file lint and `git diff --check` passed.
- Reset SQL contract and post-deployment reset verification passed.

The Vite build continues to report the existing large-chunk warning, and `npm audit` reports the pre-existing dependency findings. Neither blocked the scoped reset and stock-adjustment deployment.
