"""Read the collectors' output into the database.

    uv run python -m taste_inbox.ingest.cli

Safe to run repeatedly: ingestion is keyed on `(platform, platform_item_id)`.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..paths import REPO_ROOT
from .captures import CAPTURE_DIR, ingest_all

DEFAULT_DATABASE_URL = f"sqlite:///{REPO_ROOT / 'var' / 'data' / 'taste-inbox.db'}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, default=CAPTURE_DIR)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--collector",
        default=None,
        help=(
            "name the scheduled job this run belongs to. Recorded in the output so a log "
            "line traces back to one launchd agent; ingestion reads every capture file "
            "present either way."
        ),
    )
    args = parser.parse_args(argv)

    engine = create_engine(args.database_url or DEFAULT_DATABASE_URL)
    with sessionmaker(engine)() as session:
        report = ingest_all(session, args.captures)
        output: dict[str, object] = {"ingest": report.as_dict()}
        if args.collector:
            output["collector"] = args.collector
        print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
