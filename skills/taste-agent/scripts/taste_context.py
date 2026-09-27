#!/usr/bin/env python3
"""Print one item's TasteContext as JSON. Read-only.

    python3 skills/taste-agent/scripts/taste_context.py --list
    cd apps/api && uv run python ../../skills/taste-agent/scripts/taste_context.py <item-id>

Opens the SQLite file directly rather than going through the API, so it works when the
service is not running and cannot change anything. This is the stage-1 tool the skill
refers to; stages 2–4 go through `apps/api`.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DB = REPO_ROOT / "var" / "data" / "taste-inbox.db"


def _database() -> Path:
    raw = os.environ.get("DATABASE_URL", "")
    if raw.startswith("sqlite:///"):
        return Path(raw.removeprefix("sqlite:///"))
    return DEFAULT_DB


def _list(connection: sqlite3.Connection, limit: int) -> int:
    rows = connection.execute(
        "SELECT id, kind, platform, title FROM items ORDER BY first_seen_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    for row in rows:
        print(f"{row[0]}  {row[1]:<8} {row[2]:<12} {(row[3] or '')[:60]}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("item_id", nargs="?", help="the item to describe")
    parser.add_argument("--list", action="store_true", help="list recent item ids")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args(argv)

    database = _database()
    if not database.is_file():
        print(f"no database at {database}", file=sys.stderr)
        return 2

    if args.list or not args.item_id:
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
            return _list(connection, args.limit)

    # Imported here so `--list` works without the API package installed. The context itself
    # is the API's own builder, so it needs the API's environment.
    sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))
    try:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session

        from taste_inbox.taste import context as taste_context
    except ModuleNotFoundError as error:
        print(
            f"{error.name} is not installed here. Run it in the API's environment:\n"
            "  cd apps/api && uv run python ../../skills/taste-agent/scripts/taste_context.py "
            f"{args.item_id}",
            file=sys.stderr,
        )
        return 2

    # Read-only at the driver, not by convention: `mode=ro` makes a write an error.
    engine = create_engine(f"sqlite:///file:{database}?mode=ro&uri=true")
    with Session(engine) as session:
        built = taste_context.build(session, args.item_id)
    if built is None:
        print(f"no item {args.item_id!r}", file=sys.stderr)
        return 1
    print(json.dumps(built.as_dict(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
