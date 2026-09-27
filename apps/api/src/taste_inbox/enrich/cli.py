"""Classify liked Instagram posts into boards.

    uv run python -m taste_inbox.enrich.cli --dry-run
    uv run python -m taste_inbox.enrich.cli
    uv run python -m taste_inbox.enrich.cli --limit 20

**Running this sends text to a service off this machine.** It is the only command in the
repository that does, and it is a command rather than a scheduled job for exactly that
reason — see `docs/SECURITY_BOUNDARIES.md` §"분류기 경계" for what is sent and what is not.

`--dry-run` prints the payload that *would* be sent and writes nothing. It is the way to
check the boundary against your own data before any of it leaves, and it needs no `claude`
installed.

Safe to run repeatedly: a row that has been answered is no longer null and is never sent
again, so a second run classifies only what arrived since the first.
"""

from __future__ import annotations

import argparse
import json
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..ingest.cli import DEFAULT_DATABASE_URL
from .classify import (
    BATCH_SIZE,
    build_prompt,
    classification_targets,
    classify_boards,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--limit", type=int, default=None, help="cap the items this run")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the exact payload that would be sent, and send nothing",
    )
    args = parser.parse_args(argv)

    engine = create_engine(args.database_url or DEFAULT_DATABASE_URL)
    with sessionmaker(engine)() as session:
        if args.dry_run:
            targets = classification_targets(session)
            if args.limit is not None:
                targets = targets[: args.limit]
            entries = [entry for _, entry in targets if not entry.is_empty]
            print(f"# 분류 대상 {len(targets)}건 중 보낼 항목 {len(entries)}건")
            print("# 아래가 claude에 넘어가는 전부입니다. 링크·핸들·이미지·게시물 ID는 없습니다.")
            for start in range(0, len(entries), args.batch_size):
                print(build_prompt(entries[start : start + args.batch_size]))
                print()
            return 0

        report = classify_boards(session, limit=args.limit, batch_size=args.batch_size)
        print(json.dumps({"classify": report.as_dict()}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
