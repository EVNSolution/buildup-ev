#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev-ev2}"
REPO_URL="${REPO_URL:-https://github.com/EVNSolution/buildup-ev.git}"
DEPLOY_REF="${DEPLOY_REF:-main}"
PM2_APP_PREFIX="${PM2_APP_PREFIX:-buildup-ev-ev2}"
SERVER_NAME="${SERVER_NAME:?SERVER_NAME required}"
SSM_APP_ENV_PARAM="${SSM_APP_ENV_PARAM:-/buildup-ev/ev2/app-env}"
API_PORT_BLUE="${API_PORT_BLUE:-3101}"
API_PORT_GREEN="${API_PORT_GREEN:-3102}"

/tmp/buildup-ev2-setup.sh

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
umask 077
printf '%s\n' "$env_text" > .env

npm ci
npm exec --workspace=backend -- prisma generate
if grep -q '^RUN_DB_PUSH=1$' .env; then npm run --workspace=backend db:push; fi
if grep -q '^RUN_DB_SEED=1$' .env; then npm run --workspace=backend db:seed; fi
if grep -q '^BOOTSTRAP_ADMIN_EMAIL=.' .env; then npm run --workspace=backend bootstrap; fi
npm run --workspace=frontend build

pm2 delete "$pm2_name" >/dev/null 2>&1 || true
PORT="$port" NODE_ENV=production pm2 start ./node_modules/.bin/tsx --name "$pm2_name" -- backend/src/server.ts

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
cat > /etc/caddy/Caddyfile.d/buildup-ev2.caddy <<EOF_CADDY
${SERVER_NAME} {
	encode gzip zstd

	handle /api/* {
		reverse_proxy 127.0.0.1:${port}
	}

	handle {
		root * ${slot_dir}/frontend/dist
		try_files {path} /index.html
		file_server
	}
}
EOF_CADDY

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
printf '%s\n' "$slot" > "$APP_BASE_DIR/active-slot"
printf '%s %s %s previous=%s\n' "$ts" "$slot" "$new_commit" "${old_commit:-none}" >> "$APP_BASE_DIR/deploy.log"
pm2 save

echo "Deployed $new_commit to EV2 $slot on port $port. Previous active slot stayed $current."
