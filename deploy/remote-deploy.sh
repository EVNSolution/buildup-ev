#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"
REPO_URL="${REPO_URL:-https://github.com/EVNSolution/buildup-ev.git}"
PM2_APP_PREFIX="${PM2_APP_PREFIX:-buildup-ev}"
SERVER_NAME="${SERVER_NAME:?SERVER_NAME required}"
SSM_APP_ENV_PARAM="${SSM_APP_ENV_PARAM:-/buildup-ev/app-env}"
API_PORT_BLUE="${API_PORT_BLUE:-3101}"
API_PORT_GREEN="${API_PORT_GREEN:-3102}"
SOURCE_REVISION="${SOURCE_REVISION:?SOURCE_REVISION required}"
WORKFLOW_RUN_ID="${WORKFLOW_RUN_ID:?WORKFLOW_RUN_ID required}"
ACTOR="${ACTOR:?ACTOR required}"
VALIDATOR="${VALIDATOR:-/tmp/buildup-ev-validate-env.py}"
SETUP_MARKER="$APP_BASE_DIR/.setup-complete"
EVIDENCE_FILE="$APP_BASE_DIR/deploy-evidence.jsonl"
MANIFEST_DIR="$APP_BASE_DIR/manifests"
CADDY_FILE=/etc/caddy/Caddyfile.d/buildup-ev.caddy

[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'SOURCE_REVISION must be a full Git SHA.' >&2; exit 2; }
[[ "$WORKFLOW_RUN_ID" =~ ^[0-9]+$ ]] || { echo 'WORKFLOW_RUN_ID must be numeric.' >&2; exit 2; }
[[ "$ACTOR" =~ ^[A-Za-z0-9-]+$ ]] || { echo 'ACTOR must be a GitHub login.' >&2; exit 2; }

cleanup_file() {
  local target="$1"
  [ ! -e "$target" ] || shred -u "$target" 2>/dev/null || rm -f "$target"
}

append_evidence() {
  python3 - "$EVIDENCE_FILE" "$ACTOR" "$WORKFLOW_RUN_ID" "$@" <<'PY'
import datetime, json, os, sys
path, actor, workflow_run_id, *pairs = sys.argv[1:]
event = dict(pair.split('=', 1) for pair in pairs)
event['actor'] = actor
event['workflowRunId'] = workflow_run_id
event['timestamp'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'a', encoding='utf-8') as target:
    target.write(json.dumps(event, ensure_ascii=False) + '\n')
PY
}

write_manifest() {
  local target="$MANIFEST_DIR/$slot.json"
  python3 - "$target" "$slot" "$SOURCE_REVISION" "$LOCKFILE_SHA256" "$SSM_VERSION" "$WORKFLOW_RUN_ID" "$ACTOR" "${current:-none}" "${old_active_revision:-none}" <<'PY'
import datetime, json, os, sys, tempfile
target, slot, revision, lockfile, ssm_version, workflow_run_id, actor, previous_slot, previous_revision = sys.argv[1:]
data = {
    'slot': slot,
    'sourceRevision': revision,
    'lockfileSha256': lockfile,
    'ssmParameterVersion': int(ssm_version),
    'workflowRunId': workflow_run_id,
    'actor': actor,
    'previousSlot': previous_slot,
    'previousRevision': previous_revision,
    'preparedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
os.makedirs(os.path.dirname(target), exist_ok=True)
fd, temporary = tempfile.mkstemp(dir=os.path.dirname(target), prefix='.manifest-', text=True)
with os.fdopen(fd, 'w', encoding='utf-8') as output:
    json.dump(data, output, ensure_ascii=False, indent=2)
    output.write('\n')
os.replace(temporary, target)
PY
}

fetch_and_validate_env() {
  local payload env_candidate
  payload="$(mktemp)"
  env_candidate="$(mktemp)"
  chmod 600 "$payload" "$env_candidate"

  if ! aws ssm get-parameter --name "$SSM_APP_ENV_PARAM" --with-decryption --output json >"$payload"; then
    cleanup_file "$payload"
    cleanup_file "$env_candidate"
    echo "Unable to read SSM SecureString: $SSM_APP_ENV_PARAM" >&2
    return 1
  fi
  if ! SSM_VERSION="$(python3 - "$payload" "$env_candidate" <<'PY'
import json, os, sys
payload, target = sys.argv[1:]
with open(payload, encoding='utf-8') as source:
    parameter = json.load(source)['Parameter']
with open(target, 'w', encoding='utf-8') as output:
    output.write(parameter['Value'].rstrip('\n') + '\n')
os.chmod(target, 0o600)
print(parameter['Version'])
PY
)"; then
    cleanup_file "$payload"
    cleanup_file "$env_candidate"
    echo 'Unable to decode SSM application ENV.' >&2
    return 1
  fi
  if ! "$VALIDATOR" "$env_candidate"; then
    cleanup_file "$payload"
    cleanup_file "$env_candidate"
    return 1
  fi
  install -m 0600 "$env_candidate" .env.candidate
  mv .env.candidate .env
  cleanup_file "$payload"
  cleanup_file "$env_candidate"
  export SSM_VERSION
}

ready_matches() {
  local url="$1"
  curl -fsS --max-time 5 "$url" 2>/dev/null |
    python3 -c 'import json,sys
try: body=json.load(sys.stdin)
except (json.JSONDecodeError, UnicodeError): raise SystemExit(1)
raise SystemExit(0 if body.get("ok") is True and body.get("revision")==sys.argv[1] else 1)' "$SOURCE_REVISION"
}

public_ready_matches() {
  curl -fsS --max-time 5 --resolve "${SERVER_NAME}:443:127.0.0.1" "https://${SERVER_NAME}/api/readyz" 2>/dev/null |
    python3 -c 'import json,sys
try: body=json.load(sys.stdin)
except (json.JSONDecodeError, UnicodeError): raise SystemExit(1)
raise SystemExit(0 if body.get("ok") is True and body.get("revision")==sys.argv[1] else 1)' "$SOURCE_REVISION"
}

reload_caddy() {
  caddy validate --config /etc/caddy/Caddyfile
  if systemctl is-active --quiet caddy; then
    systemctl reload caddy
  else
    systemctl restart caddy
  fi
}

restore_caddy() {
  local caddy_file="$1" backup="$2" had_config="$3"
  if [ "$had_config" = 1 ]; then cp "$backup" "$caddy_file"; else rm -f "$caddy_file"; fi
  reload_caddy
}

if [ ! -f "$SETUP_MARKER" ]; then
  APP_BASE_DIR="$APP_BASE_DIR" /tmp/buildup-ev-setup.sh
fi
test -f "$SETUP_MARKER"
test -x "$VALIDATOR"

recorded_current="$(cat "$APP_BASE_DIR/active-slot" 2>/dev/null || true)"
observed_current=
if [ -f "$CADDY_FILE" ]; then
  if grep -Fq "reverse_proxy 127.0.0.1:${API_PORT_BLUE}" "$CADDY_FILE"; then
    observed_current=blue
  elif grep -Fq "reverse_proxy 127.0.0.1:${API_PORT_GREEN}" "$CADDY_FILE"; then
    observed_current=green
  fi
fi
if [[ "$observed_current" =~ ^(blue|green)$ ]]; then
  current="$observed_current"
  if [ "$recorded_current" != "$observed_current" ]; then
    append_evidence "event=slot-record-reconciled" "recorded=${recorded_current:-none}" "observed=$observed_current"
  fi
else
  current="$recorded_current"
fi
if [ "$current" = blue ]; then
  slot=green
  port="$API_PORT_GREEN"
else
  slot=blue
  port="$API_PORT_BLUE"
fi

slot_dir="$APP_BASE_DIR/releases/$slot"
pm2_name="$PM2_APP_PREFIX-$slot"
mkdir -p "$APP_BASE_DIR/releases" "$APP_BASE_DIR/logs" "$MANIFEST_DIR"

old_active_revision=none
if [[ "$current" =~ ^(blue|green)$ ]] && [ -d "$APP_BASE_DIR/releases/$current/.git" ]; then
  old_active_revision="$(git -C "$APP_BASE_DIR/releases/$current" rev-parse HEAD)"
fi

if [ ! -d "$slot_dir/.git" ]; then
  rm -rf "$slot_dir"
  git clone --no-checkout "$REPO_URL" "$slot_dir"
fi

cd "$slot_dir"
git fetch --no-tags --prune origin "$SOURCE_REVISION"
git checkout -B deploy-target "$SOURCE_REVISION"
git reset --hard "$SOURCE_REVISION"
test "$(git rev-parse HEAD)" = "$SOURCE_REVISION"
LOCKFILE_SHA256="$(sha256sum package-lock.json | awk '{print $1}')"

fetch_and_validate_env
npm ci
npm exec --workspace=backend -- prisma generate
npm run --workspace=backend db:drift
npm run --workspace=frontend build
chmod -R a+rX frontend/dist

pm2 delete "$pm2_name" >/dev/null 2>&1 || true
DOC_STORAGE_DIR="$APP_BASE_DIR/shared/documents" \
PORT="$port" \
NODE_ENV=production \
RELEASE_REVISION="$SOURCE_REVISION" \
RELEASE_SLOT="$slot" \
pm2 start ./node_modules/.bin/tsx --name "$pm2_name" -- backend/src/server.ts

candidate_ready=0
for _ in $(seq 1 45); do
  if ready_matches "http://127.0.0.1:${port}/api/readyz"; then candidate_ready=1; break; fi
  sleep 1
done
if [ "$candidate_ready" != 1 ]; then
  append_evidence "event=prepare-blocked" "slot=$slot" "revision=$SOURCE_REVISION" "ssmVersion=$SSM_VERSION"
  pm2 logs "$pm2_name" --lines 40 --nostream || true
  pm2 delete "$pm2_name" >/dev/null 2>&1 || true
  echo "Candidate slot $slot did not become ready." >&2
  exit 1
fi

test -f frontend/dist/index.html
write_manifest

caddy_backup="$(mktemp)"
caddy_candidate="$(mktemp /etc/caddy/Caddyfile.d/.buildup-ev-candidate.XXXXXX)"
had_caddy_config=0
if [ -f "$CADDY_FILE" ]; then
  cp "$CADDY_FILE" "$caddy_backup"
  had_caddy_config=1
fi
cat > "$caddy_candidate" <<EOF_CADDY
${SERVER_NAME} {
	root * ${slot_dir}/frontend/dist
	encode gzip zstd
	header {
		-Server
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		X-Frame-Options SAMEORIGIN
	}

	handle /api/* {
		reverse_proxy 127.0.0.1:${port}
	}

	handle {
		try_files {path} /index.html
		file_server
	}
}
EOF_CADDY
chmod 644 "$caddy_candidate"

if ! caddy validate --config "$caddy_candidate"; then
  cleanup_file "$caddy_candidate"
  cleanup_file "$caddy_backup"
  pm2 delete "$pm2_name" >/dev/null 2>&1 || true
  append_evidence "event=switch-blocked" "candidate=$slot" "restored=${current:-none}" "reason=caddy-validation"
  exit 1
fi
mv "$caddy_candidate" "$CADDY_FILE"

if ! reload_caddy; then
  restore_caddy "$CADDY_FILE" "$caddy_backup" "$had_caddy_config"
  cleanup_file "$caddy_backup"
  pm2 delete "$pm2_name" >/dev/null 2>&1 || true
  append_evidence "event=switch-rolled-back" "candidate=$slot" "restored=${current:-none}" "reason=caddy"
  exit 1
fi

external_ready=0
for _ in $(seq 1 15); do
  if public_ready_matches; then external_ready=1; break; fi
  sleep 1
done
frontend_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 --resolve "${SERVER_NAME}:443:127.0.0.1" "https://${SERVER_NAME}/" || true)"
if [ "$external_ready" != 1 ] || [ "$frontend_code" != 200 ]; then
  restore_caddy "$CADDY_FILE" "$caddy_backup" "$had_caddy_config"
  cleanup_file "$caddy_backup"
  pm2 delete "$pm2_name" >/dev/null 2>&1 || true
  append_evidence "event=switch-rolled-back" "candidate=$slot" "restored=${current:-none}" "reason=external-verification"
  echo "Candidate verification failed; restored ${current:-previous configuration}." >&2
  exit 1
fi
cleanup_file "$caddy_backup"

if [[ "$current" =~ ^(blue|green)$ ]]; then
  printf '%s\n' "$current" > "$APP_BASE_DIR/.previous-slot.candidate"
  mv "$APP_BASE_DIR/.previous-slot.candidate" "$APP_BASE_DIR/previous-slot"
fi
printf '%s\n' "$slot" > "$APP_BASE_DIR/.active-slot.candidate"
mv "$APP_BASE_DIR/.active-slot.candidate" "$APP_BASE_DIR/active-slot"
printf '%s revision=%s ssmVersion=%s lockfile=%s previous=%s\n' \
  "$(date +%Y%m%d-%H%M%S)" "$SOURCE_REVISION" "$SSM_VERSION" "$LOCKFILE_SHA256" "$old_active_revision" >> "$APP_BASE_DIR/deploy.log"
append_evidence "event=activated" "slot=$slot" "revision=$SOURCE_REVISION" "ssmVersion=$SSM_VERSION" "lockfileSha256=$LOCKFILE_SHA256" "previous=${current:-none}" "previousRevision=$old_active_revision"
pm2 save
systemctl enable --now pm2-root >/dev/null 2>&1 || true

echo "release=revision:${SOURCE_REVISION},slot:${slot},ssm:${SSM_VERSION},lockfile:${LOCKFILE_SHA256}"
