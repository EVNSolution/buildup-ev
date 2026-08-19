#!/usr/bin/env python3
"""Validate BUILDUP-EV dotenv files without printing secret values."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


KEY = re.compile(r"^[A-Z][A-Z0-9_]*$")
REQUIRED = ("DATABASE_URL", "JWT_SECRET", "MODUSIGN_DRY_RUN")
PAIRS = (
    ("MAIL_SMTP_USER", "MAIL_SMTP_PASS"),
    ("WARP_API_BASE_URL", "WARP_API_KEY"),
    ("MODUSIGN_API_KEY", "MODUSIGN_WEBHOOK_SECRET"),
)
OPTIONAL_URLS = ("PUBLIC_BASE_URL", "WARP_API_BASE_URL", "MODUSIGN_BASE_URL")
DEPLOY_OWNED = ("PORT", "NODE_ENV", "DOC_STORAGE_DIR")
FORBIDDEN = ("BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PW", "CORS_ORIGIN")


def unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_env(path: Path) -> tuple[dict[str, str], list[str]]:
    values: dict[str, str] = {}
    errors: list[str] = []
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            errors.append(f"line {number}: expected KEY=VALUE")
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        if not KEY.fullmatch(key):
            errors.append(f"line {number}: invalid key name")
            continue
        if key in values:
            errors.append(f"line {number}: duplicate key {key}")
            continue
        values[key] = unquote(value)
    return values, errors


def is_url(value: str, allow_http: bool) -> bool:
    parsed = urlparse(value)
    schemes = {"https"} | ({"http"} if allow_http else set())
    return parsed.scheme in schemes and bool(parsed.netloc) and not parsed.username


def validate(values: dict[str, str], allow_http: bool = False) -> list[str]:
    errors = [f"missing or empty key {key}" for key in REQUIRED if not values.get(key, "").strip()]

    jwt_secret = values.get("JWT_SECRET", "")
    if jwt_secret and len(jwt_secret) < 32:
        errors.append("JWT_SECRET must contain at least 32 characters")

    database_url = values.get("DATABASE_URL", "")
    if database_url and not database_url.startswith(("postgresql://", "postgres://")):
        errors.append("DATABASE_URL must use postgresql:// or postgres://")

    dry_run = values.get("MODUSIGN_DRY_RUN", "").lower()
    if dry_run and dry_run not in {"true", "false"}:
        errors.append("MODUSIGN_DRY_RUN must be true or false")

    for left, right in PAIRS:
        configured = [bool(values.get(key, "").strip()) for key in (left, right)]
        if any(configured) and not all(configured):
            errors.append(f"{left} and {right} must be configured together")

    for key in OPTIONAL_URLS:
        if values.get(key) and not is_url(values[key], allow_http):
            protocol = "HTTP or HTTPS" if allow_http else "HTTPS"
            errors.append(f"{key} must be a valid {protocol} URL without embedded credentials")

    for key in DEPLOY_OWNED:
        if key in values:
            errors.append(f"{key} is deployment-owned and must not be stored in application ENV")
    for key in FORBIDDEN:
        if key in values:
            errors.append(f"{key} is not allowed in runtime application ENV")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("env_file", type=Path)
    parser.add_argument("--allow-http", action="store_true")
    args = parser.parse_args()

    try:
        values, errors = parse_env(args.env_file)
    except (OSError, UnicodeError) as error:
        print(f"ENV validation failed: {error}", file=sys.stderr)
        return 1
    errors.extend(validate(values, args.allow_http))
    if errors:
        for error in errors:
            print(f"ENV validation failed: {error}", file=sys.stderr)
        return 1

    configured_groups = [left.removesuffix("_USER").removesuffix("_BASE_URL").removesuffix("_API_KEY")
                         for left, right in PAIRS if values.get(left) and values.get(right)]
    print(f"ENV validation passed: {len(values)} keys")
    print("required=" + ",".join(REQUIRED))
    print("configured_groups=" + (",".join(configured_groups) if configured_groups else "none"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
