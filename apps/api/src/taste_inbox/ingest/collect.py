"""One scheduled cycle: read the checkpoint, collect one surface, ingest everything.

    uv run python -m taste_inbox.ingest.collect --collector github_stars_api
    uv run python -m taste_inbox.ingest.collect --collector github_stars_api --dry-run

This is what a launchd job and the in-app scheduler run, one per surface: GitHub Stars,
Hugging Face likes, Hugging Face paper upvotes. Each is reached by the account *name*
Settings stores (`api/accounts.py`); the environment variable is still read when Settings
holds none.

**The two packages still do not import each other.** `services/collectors` owns the HTTP
and knows nothing about the database; this module owns the database. The checkpoint
travels between them as an argv string, and the collected items travel back as a file.
That seam is deliberate: it is what lets the collectors' tests run with no database and
this package's tests run with no network.

Ordering is the whole design:

    read checkpoint  →  collect one surface  →  ingest every capture present

Ingestion runs **last and always**, even when collection was skipped or failed. The capture
file is how a run reaches `checkpoints.last_outcome` and from there the Today screen, so a
rate limit has to be ingested exactly as hard as a good run does.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from ..api.accounts import PLATFORMS, SEED_LIMIT, SURFACE_PLATFORM, handle_of
from ..db.models import Checkpoint
from ..distribution import api_collection_available
from ..paths import REPO_ROOT
from .cli import DEFAULT_DATABASE_URL
from .cli import main as ingest_main

#: The collectors, keyed on the surface id.
API_COLLECTORS: tuple[str, ...] = tuple(SURFACE_PLATFORM)

#: The environment variable an account name falls back to, per platform.
ACCOUNT_ENV = {"github": "GITHUB_LOGIN", "huggingface": "HF_USERNAME"}


def _api_child_argv(collector_id: str, handle: str, last_seen: str | None) -> list[str]:
    """`probe api` for one surface: incremental from the checkpoint, or a bounded seed."""

    argv = [
        str(_collector_python()),
        "-m",
        "taste_inbox_collectors.cli",
        "api",
        "--source",
        collector_id,
        "--account",
        handle,
    ]
    if last_seen:
        return [*argv, "--last-seen", last_seen]
    return [*argv, "--limit", str(SEED_LIMIT[collector_id])]


#: Exit codes above the collector's own (0 ok, 2 platform stop, 4 busy, 5 host).
EXIT_GATED = 3
EXIT_INGEST_FAILED = 6
EXIT_DISTRIBUTION_REFUSED = 7


@contextlib.contextmanager
def _ingest_lock(wait_seconds: float = 300.0) -> Iterator[bool]:
    """One ingest at a time. Yields False if the wait ran out.

    Three jobs each end in an ingest, and a long collection pushes one into the next. Two
    concurrent writers on one SQLite file is `database is locked`.
    """
    directory = REPO_ROOT / "var" / "run"
    directory.mkdir(parents=True, exist_ok=True)
    handle = (directory / "ingest.lock").open("w")
    deadline = time.monotonic() + wait_seconds
    try:
        while True:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    yield False
                    return
                time.sleep(min(5.0, max(0.0, deadline - time.monotonic())))
        try:
            yield True
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def _collector_python() -> Path:
    """The interpreter that can import a collector.

    Not this one: `apps/api`'s venv does not have `taste_inbox_collectors` in it.
    The plist sets this so launchd's near-empty environment cannot resolve it differently.
    """
    override = os.environ.get("TASTE_INBOX_COLLECTOR_PYTHON", "").strip()
    if override:
        return Path(override)
    return REPO_ROOT / "services" / "collectors" / ".venv" / "bin" / "python"


def _emit(**fields: object) -> None:
    sys.stdout.write(json.dumps(fields, ensure_ascii=False) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector", required=True, help="the scheduled job to run")
    parser.add_argument("--captures", type=Path, default=None)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--skip-collect", action="store_true", help="ingest only")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would run — the checkpoint, the child argv — and change nothing",
    )
    args = parser.parse_args(argv)

    collector_id: str = args.collector
    collect_rc = 0

    if collector_id in API_COLLECTORS and not args.skip_collect:
        if not api_collection_available(REPO_ROOT):
            _emit(event="distribution_refused", collector=collector_id, why="api collection off")
            collect_rc = EXIT_DISTRIBUTION_REFUSED
        else:
            platform = SURFACE_PLATFORM[collector_id]
            engine = create_engine(args.database_url or DEFAULT_DATABASE_URL)
            with sessionmaker(engine)() as session:
                checkpoint = session.get(Checkpoint, collector_id)
                last_seen = checkpoint.last_seen_code if checkpoint else None
                handle = (
                    handle_of(session, platform)
                    or os.environ.get(ACCOUNT_ENV[platform], "").strip()
                    or None
                )
            engine.dispose()

            if handle is None:
                if args.dry_run:
                    _emit(event="dry_run", collector=collector_id, mode="not_connected")
                    return 0
                _emit(
                    event="not_connected",
                    collector=collector_id,
                    why=f"no {PLATFORMS[platform].label} account; add one in Settings",
                )
                collect_rc = EXIT_GATED
            else:
                child = _api_child_argv(collector_id, handle, last_seen)
                if args.dry_run:
                    _emit(
                        event="dry_run",
                        collector=collector_id,
                        last_seen=last_seen,
                        mode="incremental" if last_seen else "seed",
                        would_run=child,
                    )
                    return 0
                # `check=False`: every outcome is in the capture file this child writes, and
                # a non-zero exit is information to log, never a reason to run it again.
                # `CLAUDE.md` §7 — the next cycle is the retry.
                completed = subprocess.run(child, check=False, timeout=1800)  # noqa: S603
                collect_rc = completed.returncode
                _emit(event="collect", collector=collector_id, exit=collect_rc)
    elif args.dry_run:
        _emit(event="dry_run", collector=collector_id, mode="ingest_only")
        return 0

    # Always, whatever happened above.
    ingest_argv = ["--collector", collector_id]
    if args.captures is not None:
        ingest_argv += ["--captures", str(args.captures)]
    if args.database_url:
        ingest_argv += ["--database-url", args.database_url]

    with _ingest_lock() as acquired:
        if not acquired:
            _emit(event="ingest_skipped", collector=collector_id, why="another ingest is running")
            # Not a failure. The capture files are still on disk and ingestion is keyed on
            # `(platform, platform_item_id)`, so the next cycle reads exactly the same thing
            # and loses nothing.
            return collect_rc
        if ingest_main(ingest_argv) != 0:
            return EXIT_INGEST_FAILED

    return collect_rc


if __name__ == "__main__":
    raise SystemExit(main())
