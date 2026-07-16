#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"
REPO_URL="${REPO_URL:-https://github.com/EVNSolution/buildup-ev.git}"
DEPLOY_REF="${DEPLOY_REF:-main}"
PM2_APP_PREFIX="${PM2_APP_PREFIX:-buildup-ev}"
SERVER_NAME="${SERVER_NAME:?SERVER_NAME required}"
SSM_APP_ENV_PARAM="${SSM_APP_ENV_PARAM:-/buildup-ev/app-env}"
API_PORT_BLUE="${API_PORT_BLUE:-3101}"
API_PORT_GREEN="${API_PORT_GREEN:-3102}"

/tmp/buildup-ev-setup.sh

get_param() {
  aws ssm get-parameter --name "$1" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true
}

current="$(cat "$APP_BASE_DIR/active-slot" 2>/dev/null || true)"
if [ "$current" = blue ]; then
  slot=green
  port="$API_PORT_GREEN"
else
  slot=blue
  port="$API_PORT_BLUE"
fi

slot_dir="$APP_BASE_DIR/releases/$slot"
pm2_name="$PM2_APP_PREFIX-$slot"
ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$APP_BASE_DIR/releases" "$APP_BASE_DIR/logs"

if [ ! -d "$slot_dir/.git" ]; then
  rm -rf "$slot_dir"
  git clone "$REPO_URL" "$slot_dir"
fi

cd "$slot_dir"
old_commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
git fetch --prune origin "$DEPLOY_REF"
git checkout -B deploy-target FETCH_HEAD
git reset --hard FETCH_HEAD
new_commit="$(git rev-parse --short HEAD)"

env_text="$(get_param "$SSM_APP_ENV_PARAM")"
if [ -z "$env_text" ] || [ "$env_text" = None ]; then
  echo "Missing SSM SecureString: $SSM_APP_ENV_PARAM" >&2
  exit 1
fi
( umask 077; printf '%s\n' "$env_text" > .env )

npm ci
npm exec --workspace=backend -- prisma generate
if grep -q '^RUN_DB_PUSH=1$' .env; then npm run --workspace=backend db:push; fi
if grep -q '^RUN_DB_SEED=1$' .env; then npm run --workspace=backend db:seed; fi
if grep -q '^BOOTSTRAP_ADMIN_EMAIL=.' .env; then npm run --workspace=backend bootstrap; fi
npm run --workspace=frontend build
npm cache clean --force >/dev/null 2>&1 || true
chmod -R a+rX frontend/dist

pm2 delete "$pm2_name" >/dev/null 2>&1 || true
DOC_STORAGE_DIR="$APP_BASE_DIR/shared/documents" PORT="$port" NODE_ENV=production pm2 start ./node_modules/.bin/tsx --name "$pm2_name" -- backend/src/server.ts

ok=0
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/v1/auth/me" || true)"
  if [ "$code" = 403 ] || [ "$code" = 200 ]; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "New slot $slot did not become healthy on port $port" >&2
  pm2 logs "$pm2_name" --lines 80 --nostream || true
  exit 1
fi

test -f frontend/dist/index.html
cat > /etc/caddy/Caddyfile.d/buildup-ev.caddy <<EOF_CADDY
${SERVER_NAME} {
	root * ${slot_dir}/frontend/dist
	encode gzip zstd

	handle /api/* {
		reverse_proxy 127.0.0.1:${port}
	}

	handle {
		try_files {path} /index.html
		file_server
	}
}
EOF_CADDY
chmod 644 /etc/caddy/Caddyfile.d/buildup-ev.caddy

caddy validate --config /etc/caddy/Caddyfile
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  if pgrep -x caddy >/dev/null; then
    caddy stop || true
    sleep 1
  fi
  if pgrep -x caddy >/dev/null; then
    pkill -x caddy || true
    sleep 1
  fi
  systemctl reset-failed caddy || true
  systemctl restart caddy
fi
systemctl is-active --quiet caddy

active_config_ok=0
for _ in $(seq 1 10); do
  active_config="$(curl -fsS http://127.0.0.1:2019/config/ || true)"
  if printf '%s' "$active_config" | grep -q "127.0.0.1:${port}" \
    && printf '%s' "$active_config" | grep -q "${slot_dir}/frontend/dist"; then
    active_config_ok=1
    break
  fi
  sleep 1
done
frontend_code="$(curl -k -s -o /dev/null -w '%{http_code}' --resolve "${SERVER_NAME}:443:127.0.0.1" "https://${SERVER_NAME}/" || true)"
if [ "$active_config_ok" != 1 ] || [ "$frontend_code" != 200 ]; then
  echo "Caddy did not serve the new slot $slot on port $port (frontend HTTP $frontend_code)" >&2
  systemctl status caddy --no-pager || true
  curl -s http://127.0.0.1:2019/config/ || true
  exit 1
fi

printf '%s\n' "$slot" > "$APP_BASE_DIR/active-slot"
printf '%s %s %s previous=%s\n' "$ts" "$slot" "$new_commit" "${old_commit:-none}" >> "$APP_BASE_DIR/deploy.log"
pm2 save
systemctl enable --now pm2-root >/dev/null 2>&1 || true

echo "Deployed $new_commit to $slot on port $port. Previous active slot stayed $current."
