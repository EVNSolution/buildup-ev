#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"

need_cmd() { command -v "$1" >/dev/null 2>&1; }
install_pkg() {
  if need_cmd apt-get; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y "$@"
  elif need_cmd dnf; then
    dnf install -y "$@"
  elif need_cmd yum; then
    yum install -y "$@"
  else
    echo 'Unsupported package manager. Deploy targets Ubuntu/Amazon Linux EC2.' >&2
    exit 1
  fi
}

install_caddy() {
  if ! need_cmd caddy; then
    arch="$(uname -m)"
    case "$arch" in
      x86_64) caddy_arch=amd64 ;;
      aarch64|arm64) caddy_arch=arm64 ;;
      *) echo "Unsupported Caddy architecture: $arch" >&2; exit 1 ;;
    esac
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${caddy_arch}" -o /usr/local/bin/caddy
    chmod +x /usr/local/bin/caddy
  fi

  useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy 2>/dev/null || true
  mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
  chown -R caddy:caddy /var/lib/caddy /var/log/caddy
  cat >/etc/systemd/system/caddy.service <<'EOF_SYSTEMD'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
Environment=HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF_SYSTEMD
  systemctl daemon-reload
}


disable_legacy_caddy_container() {
  if ! need_cmd docker; then return; fi
  cid="$(docker ps -aq --filter name=buildup-ev-caddy | head -1 || true)"
  if [ -z "$cid" ]; then return; fi

  if [ -d /var/lib/docker/volumes/buildup-ev-caddy-data/_data/caddy ]; then
    mkdir -p /var/lib/caddy/.local/share/caddy
    cp -a /var/lib/docker/volumes/buildup-ev-caddy-data/_data/caddy/. /var/lib/caddy/.local/share/caddy/ || true
    chown -R caddy:caddy /var/lib/caddy
  fi

  docker update --restart=no "$cid" >/dev/null 2>&1 || true
  docker stop "$cid" >/dev/null 2>&1 || true
}

install_docgen_deps() {
  # 구조변경 서류 자동생성(docgen): python3 + openpyxl + LibreOffice(headless).
  # ⚠️ 비치명(best-effort): 실패해도 배포는 계속 — 서류 기능만 503로 degrade되고
  #    사이트 전체를 막지 않는다. distro별 패키지명 차이도 폴백으로 흡수.
  {
    need_cmd python3 || install_pkg python3 || true
    if ! need_cmd soffice && ! need_cmd libreoffice; then
      install_pkg libreoffice-calc || install_pkg libreoffice || true
    fi
    if ! python3 -c 'import openpyxl' >/dev/null 2>&1; then
      python3 -m pip install --quiet --upgrade openpyxl 2>/dev/null \
        || install_pkg python3-openpyxl \
        || { install_pkg python3-pip && python3 -m pip install --quiet openpyxl; } \
        || true
    fi
  } || true
  if need_cmd soffice || need_cmd libreoffice; then
    echo 'docgen deps: LibreOffice present'
  else
    echo 'WARN: LibreOffice 미설치 — 서류(docgen) 기능 비활성(503). 서버에서 수동 설치 필요.' >&2
  fi
}

install_pkg ca-certificates git openssl unzip
if ! need_cmd curl; then install_pkg curl; fi
install_caddy
disable_legacy_caddy_container
install_docgen_deps

if ! swapon --show=NAME | grep -qx '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! need_cmd aws; then
  arch="$(uname -m)"
  case "$arch" in
    x86_64) aws_arch=x86_64 ;;
    aarch64|arm64) aws_arch=aarch64 ;;
    *) echo "Unsupported AWS CLI architecture: $arch" >&2; exit 1 ;;
  esac
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" -o /tmp/awscliv2.zip
  rm -rf /tmp/aws
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install --update
fi

if ! need_cmd node || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 20 ]; then
  if need_cmd apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    install_pkg nodejs22 || install_pkg nodejs
    if need_cmd node-22; then alternatives --set node /usr/bin/node-22 || true; fi
  fi
fi

if ! need_cmd pm2; then
  npm install -g pm2
fi
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

mkdir -p "$APP_BASE_DIR/releases" "$APP_BASE_DIR/shared" /etc/caddy/Caddyfile.d
touch /etc/caddy/Caddyfile
grep -q 'Caddyfile.d/\*.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/Caddyfile.d/*.caddy\n' >> /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
