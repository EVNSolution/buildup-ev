#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-buildup-ev-postgres}"
SOURCE_REVISION="${SOURCE_REVISION:?SOURCE_REVISION required}"
BASELINE_MIGRATION="20260819000000_baseline"
EXPECTED_DRIFT="deploy/baseline-expected-drift.sql"

[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'SOURCE_REVISION must be a full Git SHA.' >&2; exit 2; }
test -f .env
test -f "backend/prisma/migrations/$BASELINE_MIGRATION/migration.sql"
test -f "$EXPECTED_DRIFT"
test -x deploy/backup-database.sh

run_prisma() {
  node --env-file=.env ./backend/node_modules/prisma/build/index.js "$@"
}

psql_query() {
  local query="$1"
  docker exec "$POSTGRES_CONTAINER" sh -c \
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"' \
    sh "$query"
}

exec 9>"$APP_BASE_DIR/.schema-migration.lock"
flock -w 120 9

ledger="$(psql_query "SELECT COALESCE(to_regclass('public._prisma_migrations')::text, '');")"
if [ -n "$ledger" ]; then
  applied="$(psql_query "SELECT count(*) FROM _prisma_migrations WHERE migration_name='$BASELINE_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;")"
  test "$applied" -eq 1
  echo 'schema_baseline=already-applied'
  exit 0
fi

business_tables="$(psql_query "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")"
test "$business_tables" -gt 0
npm run --workspace=backend db:drift

actual_drift="$(mktemp)"
trap 'rm -f "$actual_drift"' EXIT
run_prisma migrate diff \
  --from-schema-datasource backend/prisma/schema.prisma \
  --to-schema-datamodel backend/prisma/schema.prisma \
  --script \
  --output "$actual_drift"
if ! cmp -s "$EXPECTED_DRIFT" "$actual_drift"; then
  echo 'Existing database differs from the reviewed baseline contract.' >&2
  echo "expected_drift_sha256=$(sha256sum "$EXPECTED_DRIFT" | awk '{print $1}')" >&2
  echo "actual_drift_sha256=$(sha256sum "$actual_drift" | awk '{print $1}')" >&2
  exit 1
fi

APP_BASE_DIR="$APP_BASE_DIR" \
POSTGRES_CONTAINER="$POSTGRES_CONTAINER" \
SOURCE_REVISION="$SOURCE_REVISION" \
  deploy/backup-database.sh
run_prisma migrate resolve --applied "$BASELINE_MIGRATION" --schema backend/prisma/schema.prisma

applied="$(psql_query "SELECT count(*) FROM _prisma_migrations WHERE migration_name='$BASELINE_MIGRATION' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;")"
test "$applied" -eq 1
echo "schema_baseline=$BASELINE_MIGRATION"
