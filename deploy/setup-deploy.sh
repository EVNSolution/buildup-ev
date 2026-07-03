#!/usr/bin/env bash
set -euo pipefail

APP_BASE_DIR="${APP_BASE_DIR:-/opt/buildup-ev}"

need_cmd() { command -v "$1" >/dev/null 2>&1; }

if ! need_cmd apt-get; then
  echo 'Unsupported package manager. Deploy targets Ubuntu EC2.' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git openssl unzip caddy

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
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! need_cmd pm2; then
  npm install -g pm2
fi

mkdir -p "$APP_BASE_DIR/releases" "$APP_BASE_DIR/shared" /etc/caddy/Caddyfile.d
touch /etc/caddy/Caddyfile
grep -q 'Caddyfile.d/\*.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/Caddyfile.d/*.caddy\n' >> /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null
