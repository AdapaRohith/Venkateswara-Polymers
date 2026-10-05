#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

MODE="${1:---verify-only}"
if [[ "$MODE" != "--verify-only" && "$MODE" != "--create-bundle" ]]; then
  echo "usage: $0 [--verify-only|--create-bundle]" >&2
  exit 2
fi

DB_NAME="venkateswara_polymers"
DB_OWNER="$(sudo -u postgres psql -X -At -d postgres -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='$DB_NAME'")"
if [[ ! "$DB_OWNER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "could not determine a safe database owner for $DB_NAME" >&2
  exit 1
fi
BACKUP_ROOT="/root/backups"
BACKEND_DIR="/root/backend"
REPO_DIR="/root/Venkateswara-Polymers"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGING_DB="vp_restore_${STAMP,,}_$$"
WORK_DIR="$(mktemp -d /root/vp-reset-backup.XXXXXX)"
BUNDLE_DIR="$WORK_DIR/venkateswara-polymers-reset-$STAMP"
ARCHIVE="$BACKUP_ROOT/venkateswara-polymers-reset-$STAMP.tar.gz"

cleanup() {
  sudo -u postgres dropdb --if-exists "$STAGING_DB" >/dev/null 2>&1 || true
  if [[ "$WORK_DIR" == /root/vp-reset-backup.* && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$BUNDLE_DIR/backend" "$BUNDLE_DIR/repository"

sudo -u postgres pg_dump -Fc -d "$DB_NAME" > "$BUNDLE_DIR/database.dump"
pg_restore --list "$BUNDLE_DIR/database.dump" >/dev/null

cp -- "$BACKEND_DIR/server.py" "$BACKEND_DIR/requirements.txt" "$BACKEND_DIR/ecosystem.config.js" "$BUNDLE_DIR/backend/"
if [[ -f "$BACKEND_DIR/.env" ]]; then
  cp -- "$BACKEND_DIR/.env" "$BUNDLE_DIR/backend/.env"
fi
git -C "$REPO_DIR" bundle create "$BUNDLE_DIR/repository/source.bundle" --all
git -C "$REPO_DIR" rev-parse HEAD > "$BUNDLE_DIR/repository/commit.txt"
printf '%s\n' "$DB_OWNER" > "$BUNDLE_DIR/database-owner.txt"

sudo -u postgres createdb --owner="$DB_OWNER" "$STAGING_DB"
set +o pipefail
cat "$BUNDLE_DIR/database.dump" | sudo -u postgres pg_restore --exit-on-error -d "$STAGING_DB"
restore_pipe=("${PIPESTATUS[@]}")
set -o pipefail
if [[ "${restore_pipe[1]}" -ne 0 || ("${restore_pipe[0]}" -ne 0 && "${restore_pipe[0]}" -ne 141) ]]; then
  echo "staging restore failed (cat=${restore_pipe[0]}, pg_restore=${restore_pipe[1]})" >&2
  exit 1
fi

sudo -u postgres psql -X -At -d "$DB_NAME" -c \
  "SELECT table_name || '=' || row_count FROM (SELECT 'users' table_name, count(*) row_count FROM users UNION ALL SELECT 'machines', count(*) FROM machines UNION ALL SELECT 'materials_master', count(*) FROM materials_master UNION ALL SELECT 'material_types', count(*) FROM material_types UNION ALL SELECT 'system_config', count(*) FROM system_config) q ORDER BY table_name" \
  > "$BUNDLE_DIR/production-master-counts.txt"
sudo -u postgres psql -X -At -d "$STAGING_DB" -c \
  "SELECT table_name || '=' || row_count FROM (SELECT 'users' table_name, count(*) row_count FROM users UNION ALL SELECT 'machines', count(*) FROM machines UNION ALL SELECT 'materials_master', count(*) FROM materials_master UNION ALL SELECT 'material_types', count(*) FROM material_types UNION ALL SELECT 'system_config', count(*) FROM system_config) q ORDER BY table_name" \
  > "$BUNDLE_DIR/restored-master-counts.txt"
diff -u "$BUNDLE_DIR/production-master-counts.txt" "$BUNDLE_DIR/restored-master-counts.txt"

cat > "$BUNDLE_DIR/RESTORE.txt" <<'EOF'
1. Stop vp-api.
2. Read the recorded role from database-owner.txt and recreate venkateswara_polymers with that owner, for example:
   DB_OWNER="$(cat database-owner.txt)"
   sudo -u postgres dropdb --if-exists venkateswara_polymers
   sudo -u postgres createdb --owner="$DB_OWNER" venkateswara_polymers
3. Run: sudo -u postgres pg_restore --exit-on-error -d venkateswara_polymers database.dump
4. Restore backend files (including .env) to /root/backend with root-only permissions.
5. Clone the Git bundle, check out the commit recorded in repository/commit.txt, and deploy the frontend.
6. Start vp-api and verify loopback/public HTTP health before reopening writes.
EOF

(cd "$BUNDLE_DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
(cd "$BUNDLE_DIR" && sha256sum -c SHA256SUMS)

if [[ "$MODE" == "--create-bundle" ]]; then
  tar -C "$WORK_DIR" -czf "$ARCHIVE" "$(basename "$BUNDLE_DIR")"
  chmod 600 "$ARCHIVE"
  sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
  chmod 600 "$ARCHIVE.sha256"
  echo "$ARCHIVE"
else
  echo "backup verification passed using staging database $STAGING_DB"
fi
