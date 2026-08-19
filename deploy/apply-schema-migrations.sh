#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-buildup-ev-postgres}"
SOURCE_REVISION="${SOURCE_REVISION:?SOURCE_REVISION required}"
MIGRATION_DIR="backend/prisma/migrations"

[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'SOURCE_REVISION must be a full Git SHA.' >&2; exit 2; }
test -f .env
test -f "$MIGRATION_DIR/migration_lock.toml"
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
business_tables="$(psql_query "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations';")"
if [ -z "$ledger" ] && [ "$business_tables" -gt 0 ]; then
  echo 'Existing database is not baselined. Run deploy/baseline-existing-database.sh first.' >&2
  exit 1
fi

applied="$(mktemp)"
trap 'rm -f "$applied"' EXIT
if [ -n "$ledger" ]; then
  psql_query "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;" > "$applied"
fi

pending=0
total=0
for migration in "$MIGRATION_DIR"/*/migration.sql; do
  test -f "$migration"
  name="$(basename "$(dirname "$migration")")"
  total=$((total + 1))
  grep -Fxq "$name" "$applied" || pending=$((pending + 1))
done

if [ "$pending" -gt 0 ]; then
  APP_BASE_DIR="$APP_BASE_DIR" \
  POSTGRES_CONTAINER="$POSTGRES_CONTAINER" \
  SOURCE_REVISION="$SOURCE_REVISION" \
    deploy/backup-database.sh
fi

run_prisma migrate deploy --schema backend/prisma/schema.prisma
run_prisma migrate status --schema backend/prisma/schema.prisma
run_prisma migrate diff \
  --exit-code \
  --from-schema-datasource backend/prisma/schema.prisma \
  --to-schema-datamodel backend/prisma/schema.prisma

applied_total="$(psql_query "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;")"
test "$applied_total" -eq "$total"
echo "schema_migrations_applied=$pending"
echo "schema_migrations_total=$applied_total"
