#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-buildup-ev-postgres}"
SOURCE_REVISION="${SOURCE_REVISION:?SOURCE_REVISION required}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
BACKUP_DIR="$APP_BASE_DIR/shared/backups"

[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'SOURCE_REVISION must be a full Git SHA.' >&2; exit 2; }
[[ "$BACKUP_KEEP" =~ ^[1-9][0-9]*$ ]] || { echo 'BACKUP_KEEP must be a positive integer.' >&2; exit 2; }

cleanup_file() {
  local target="$1"
  [ ! -e "$target" ] || shred -u "$target" 2>/dev/null || rm -f "$target"
}

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
short_revision="${SOURCE_REVISION:0:12}"
candidate="$(mktemp "$BACKUP_DIR/.schema-${timestamp}-${short_revision}.XXXXXX")"
final="$BACKUP_DIR/schema-${timestamp}-${short_revision}.dump"
trap 'cleanup_file "$candidate"' EXIT

docker exec "$POSTGRES_CONTAINER" sh -c \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$candidate"
test -s "$candidate"
docker exec -i "$POSTGRES_CONTAINER" sh -c 'exec pg_restore -l >/dev/null' < "$candidate"
test ! -e "$final"
mv "$candidate" "$final"
trap - EXIT

python3 - "$BACKUP_DIR" "$BACKUP_KEEP" <<'PY'
import sys
from pathlib import Path

directory = Path(sys.argv[1])
keep = int(sys.argv[2])
backups = sorted(directory.glob("schema-*.dump"), key=lambda path: path.stat().st_mtime, reverse=True)
for backup in backups[keep:]:
    backup.unlink()
PY

echo "schema_backup=$final"
