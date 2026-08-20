#!/usr/bin/env python3
"""Validate privacy-preflight metadata and scalar psql output without echoing data."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


AUDIT_ID = re.compile(r"[a-z0-9][a-z0-9._-]{2,63}")


def read_contract(marker: Path, query: Path, migration: Path) -> str:
    if not marker.is_file() or not query.is_file() or not migration.is_file():
        raise ValueError("privacy preflight declaration is incomplete")
    lines = marker.read_text(encoding="utf-8").splitlines()
    if len(lines) != 1 or not AUDIT_ID.fullmatch(lines[0]):
        raise ValueError("privacy preflight audit id is invalid")
    if not query.read_text(encoding="utf-8").strip():
        raise ValueError("privacy preflight query is empty")
    migration_sql = migration.read_text(encoding="utf-8")
    if f"-- privacy-abort-guard: {lines[0]}" not in migration_sql.splitlines():
        raise ValueError("privacy migration is missing its transaction-level abort guard marker")
    return lines[0]


def parse_count(raw: str) -> int:
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) != 1 or not re.fullmatch(r"[0-9]+", lines[0]):
        raise ValueError("privacy preflight must return one non-negative integer")
    return int(lines[0])


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    contract = commands.add_parser("contract")
    contract.add_argument("marker", type=Path)
    contract.add_argument("query", type=Path)
    contract.add_argument("migration", type=Path)
    count = commands.add_parser("count")
    count.add_argument("audit_id")
    args = parser.parse_args()

    try:
        if args.command == "contract":
            print(read_contract(args.marker, args.query, args.migration))
        else:
            if not AUDIT_ID.fullmatch(args.audit_id):
                raise ValueError("privacy preflight audit id is invalid")
            print(parse_count(sys.stdin.read()))
    except (OSError, UnicodeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
