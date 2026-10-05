# Production reset runbook

Run only from the Mula VPS as root.

1. Copy the reviewed `ops/reset` directory and migration 006 to a temporary root-only directory.
2. Run `backup-and-verify.sh --verify-only` while production remains online. This restore check retains database grants so the application role is exercised against a faithful clone.
3. Record preserved master counts and the current backup inventory.
4. Stop `vp-api`, then run `backup-and-verify.sh --create-bundle` to freeze one complete restoration point.
5. Apply `migrations/006_full_operational_reset.sql` with `psql -X -v ON_ERROR_STOP=1`.
6. Deploy the reviewed backend and restart `vp-api`.
7. Run `verify-reset.sql`, loopback/public health checks, and the controlled adjustment smoke test.
8. Only after every check passes, delete the explicitly inventoried older Venkateswara backups and retain the new archive plus its checksum.

If a check fails before the reset transaction commits, restart the unchanged service. If a required check fails after commit, follow the archive's `RESTORE.txt` before reopening writes.
