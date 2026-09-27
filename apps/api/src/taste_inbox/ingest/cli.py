"""Read the collectors' output into the database, then cache the media.

    uv run python -m taste_inbox.ingest.cli
    uv run python -m taste_inbox.ingest.cli --no-media
    uv run python -m taste_inbox.ingest.cli --expiring-only

Safe to run repeatedly: ingestion is keyed on `(platform, platform_item_id)`, and a
thumbnail already on disk is never fetched twice.
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
from .links import resolve_shortened
from .media import cache_pending, expiring_within

DEFAULT_DATABASE_URL = f"sqlite:///{REPO_ROOT / 'var' / 'data' / 'taste-inbox.db'}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, default=CAPTURE_DIR)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--no-media", action="store_true", help="skip the thumbnail download")
    parser.add_argument(
        "--expiring-only",
        action="store_true",
        help="report how many thumbnails are about to expire, and change nothing",
    )
    parser.add_argument("--limit", type=int, default=None, help="cap the downloads this run")
    parser.add_argument(
        "--collector",
        default=None,
        help=(
            "name the scheduled job this run belongs to. Recorded in the output so a log "
            "line traces back to one launchd agent; ingestion reads every capture file "
            "present either way."
        ),
    )
    parser.add_argument(
        "--resolve-links",
        action="store_true",
        help="follow shortened links to find where they point",
    )
    args = parser.parse_args(argv)

    engine = create_engine(args.database_url or DEFAULT_DATABASE_URL)
    with sessionmaker(engine)() as session:
        if args.expiring_only:
            print(
                json.dumps(
                    {
                        "expiring_within_24h": expiring_within(session, 24),
                        "expiring_within_72h": expiring_within(session, 72),
                    },
                    indent=2,
                )
            )
            return 0

        report = ingest_all(session, args.captures)
        output: dict[str, object] = {"ingest": report.as_dict()}
        if args.collector:
            output["collector"] = args.collector
        if args.resolve_links:
            output["links"] = resolve_shortened(session).as_dict()
        if not args.no_media:
            output["media"] = cache_pending(session, limit=args.limit).as_dict()
        print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
