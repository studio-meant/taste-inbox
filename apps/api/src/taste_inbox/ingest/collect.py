"""One scheduled cycle: read the checkpoint, collect one surface, ingest everything.

    uv run python -m taste_inbox.ingest.collect --collector github_stars
    uv run python -m taste_inbox.ingest.collect --collector github_stars --dry-run

This is what a launchd job runs. It exists because the job used to run `ingest.cli`, which
only reads capture files that are *already on disk* — six agents waking every four hours to
re-read the same files and collect nothing. The three browser collectors had no runnable
entry point at all; `collect_source` was called by one test and nothing else.

**Two collector shapes, not one plus an exception.** `probe sources --surface <id>` collects
one of three browser surfaces; `probe collect` collects the Instagram Likes grid, and it is
a different subcommand taking different arguments and writing a differently named file.
`COLLECTOR_SHAPES` below is what the two have in common stated as data — a subcommand, what
names its subject, and how big an incremental run may be — so adding a third is a row rather
than a branch. Everything after the argv is built is identical for both: the same checkpoint
table, the same gate, the same ingest, the same lock.

**The classifier runs at the end of this cycle**, bounded and refusable — see
`_classify_pending` at the bottom of this file for what that costs and what bounds it.

**The two packages still do not import each other.** `services/collectors` owns the browser
and knows nothing about the database; this module owns the database and never imports
playwright. The checkpoint travels between them as an argv string, and the collected items
travel back as a file. That seam is deliberate: it is what lets the collectors' tests run
with no database and this package's tests run with no browser.

Ordering is the whole design:

    read checkpoint  →  (gate?)  →  collect one surface  →  ingest every capture present

Ingestion runs **last and always**, even when collection was skipped or failed. The capture
file is how a run reaches `checkpoints.last_outcome` and from there the Today screen, so a
login wall has to be ingested exactly as hard as a good run does. It is also what lets a
hand-run `probe sources` clear a gate this module set.
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
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from ..db.models import Checkpoint, CollectorRun
from ..distribution import browser_automation_available
from ..paths import REPO_ROOT
from .captures import BROWSER_SURFACES, LIKES_COLLECTOR
from .cli import DEFAULT_DATABASE_URL
from .cli import main as ingest_main


@dataclass(frozen=True, slots=True)
class CollectorShape:
    """How this driver reaches one collector.

    Three fields, and each one exists because the two shapes genuinely disagree about it.
    Everything they agree about — read the checkpoint, apply the gate, spawn, ingest — is
    written once below and takes no configuration.
    """

    #: The `probe` subcommand. `sources` for the browser surfaces, `collect` for Likes.
    subcommand: str

    #: Arguments naming *what* to collect. `sources` serves three surfaces and has to be
    #: told which; `collect` has exactly one subject — the Likes grid — and takes none.
    subject: tuple[str, ...] = ()

    #: How many items an *incremental* run may take, or None to leave it to the collector's
    #: own budget.
    #:
    #: `sources` needs no cap once it has a checkpoint: it scrolls a list and stops when the
    #: last-seen id reappears, and its own `RunBudget` allows 300 for exactly that. `collect`
    #: has to **open a post per item** — the Likes grid is a Bloks surface whose tiles carry
    #: no permalink — so an unbounded incremental run is unbounded browsing on somebody's
    #: account. Forty tiles is a generous day of likes at four-hour cycles and a hard stop if
    #: the checkpoint has gone missing.
    incremental_limit: int | None = None


#: The collectors this module can actually run, and how each is reached.
#:
#: Everything else — the three `instagram_saved_*` jobs — falls through to ingest-only,
#: honestly: Instagram stopped serving named collections on the web on 2026-08-09 (see
#: `captures.py`), so those boards are filled by `probe saved` run by hand, and a job that
#: pretended otherwise would report success for work it never did.
COLLECTOR_SHAPES: dict[str, CollectorShape] = {
    **{
        surface: CollectorShape("sources", subject=("--surface", surface))
        for surface in BROWSER_SURFACES
    },
    LIKES_COLLECTOR: CollectorShape("collect", incremental_limit=40),
}

#: Every id this driver knows how to collect. Kept as a name because the gate, the dry run
#: and `main` all ask the same membership question.
BROWSER_COLLECTORS: tuple[str, ...] = tuple(COLLECTOR_SHAPES)

#: Consecutive login walls before this collector stops asking.
#:
#: One page load every four hours is not the aggressive retry `CLAUDE.md` §7 forbids, and
#: letting it try again is what makes `uv run probe login` a sufficient fix — no second
#: command, no clearing a flag. But a session nobody has repaired by the third cycle is a
#: person's job, not a timer's, and by then the timer is just knocking on a locked door.
AUTH_PATIENCE = 3

#: Exit codes above the collector's own (0 ok, 2 platform stop, 4 busy, 5 host).
EXIT_GATED = 3
EXIT_INGEST_FAILED = 6
EXIT_DISTRIBUTION_REFUSED = 7

#: How many liked posts one cycle may classify.
#:
#: A bound rather than a batch size: the classifier sends text off this machine, and a run
#: that found a thousand undecided rows should work them off over several cycles instead of
#: making one enormous send. Forty matches the Likes collector's own incremental cap, so a
#: cycle can classify everything that cycle could have collected.
_CLASSIFY_LIMIT = 40


@contextlib.contextmanager
def _ingest_lock(wait_seconds: float = 300.0) -> Iterator[bool]:
    """One ingest at a time. Yields False if the wait ran out.

    `services/collectors/browser/session_lock.py` is the same twenty lines, and importing it
    would be the shorter code — but it would also make this package depend on the collectors
    package, which is exactly the seam this module exists to keep open. Two small copies of
    `flock` on either side of a boundary is cheaper than the boundary going away.

    Six jobs three minutes apart each end in an ingest, and a long collection pushes one
    into the next. Two concurrent writers on one SQLite file is `database is locked`.
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

    Not this one: `apps/api`'s venv has neither playwright nor `taste_inbox_collectors`.
    The plist sets this so launchd's near-empty environment cannot resolve it differently.
    """
    override = os.environ.get("TASTE_INBOX_COLLECTOR_PYTHON", "").strip()
    if override:
        return Path(override)
    return REPO_ROOT / "services" / "collectors" / ".venv" / "bin" / "python"


def _gate(session: Session, collector_id: str) -> str | None:
    """Why this collector must not be opened right now, or None.

    Two rules, deliberately asymmetric:

    `blocked` is terminal and immediate. A challenge means the platform has said stop, and
    `CLAUDE.md` §7 forbids retrying it — so no timer re-opens that account, ever, until a
    person does.

    `auth_required` is patient. A logged-out session is ordinary and self-inflicted, and the
    next run costs one page load, so it gets `AUTH_PATIENCE` chances before this stops
    asking.
    """
    checkpoint = session.get(Checkpoint, collector_id)
    if checkpoint is None:
        return None
    if checkpoint.last_outcome == "blocked":
        return "the last run was blocked; a challenge is terminal until a person clears it"

    recent = list(
        session.scalars(
            select(CollectorRun.outcome)
            .where(CollectorRun.collector_id == collector_id)
            .order_by(CollectorRun.started_at.desc())
            .limit(AUTH_PATIENCE)
        )
    )
    if len(recent) == AUTH_PATIENCE and all(outcome == "auth_required" for outcome in recent):
        return f"{AUTH_PATIENCE} consecutive login walls; log in by hand to resume"
    return None


def _emit(**fields: object) -> None:
    sys.stdout.write(json.dumps(fields, ensure_ascii=False) + "\n")


def _child_argv(collector_id: str, last_seen: str | None, seed_limit: int) -> list[str]:
    """The collector command for one job, built from that job's shape.

    The seeding branch is shared and is the same rule for both shapes: with no checkpoint,
    take the newest `--seed-limit` items and nothing older. A first run must not walk a
    history — `probe sources` would page a whole starred list and `probe collect` would open
    a post per tile for as long as the budget allowed.
    """
    shape = COLLECTOR_SHAPES[collector_id]
    argv = [
        str(_collector_python()),
        "-m",
        "taste_inbox_collectors.cli",
        shape.subcommand,
        *shape.subject,
    ]
    if not last_seen:
        return [*argv, "--limit", str(seed_limit)]
    argv += ["--last-seen", last_seen]
    if shape.incremental_limit is not None:
        argv += ["--limit", str(shape.incremental_limit)]
    return argv


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collector", required=True, help="the scheduled job to run")
    parser.add_argument("--captures", type=Path, default=None)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument(
        "--seed-limit", type=int, default=5, help="newest items to take on a first run"
    )
    parser.add_argument(
        "--media-limit", type=int, default=100, help="cap the thumbnail downloads this cycle"
    )
    parser.add_argument("--skip-collect", action="store_true", help="ingest only")
    parser.add_argument(
        "--no-classify",
        action="store_true",
        help=(
            "do not classify. The classifier is the one thing here that sends collected "
            "text off this machine, so refusing it must not require editing code."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would run — the checkpoint, the child argv — and change nothing",
    )
    args = parser.parse_args(argv)

    collector_id: str = args.collector
    collect_rc = 0

    distribution_refused = (
        collector_id in BROWSER_COLLECTORS
        and not args.skip_collect
        and not browser_automation_available(REPO_ROOT)
    )

    if distribution_refused:
        if args.dry_run:
            _emit(
                event="dry_run",
                collector=collector_id,
                mode="distribution_refused",
                would_run=None,
            )
            return 0
        _emit(
            event="distribution_refused",
            collector=collector_id,
            why=(
                "community releases do not contain or run logged-in browser automation; "
                "only local capture ingestion is available"
            ),
        )
        # Do not return. A capture the user imported themselves is still ordinary local
        # data, and the invariant of this driver is that ingestion happens after every
        # collection outcome. The non-zero exit keeps a scheduler from calling this a
        # successful collection.
        collect_rc = EXIT_DISTRIBUTION_REFUSED
    elif collector_id in BROWSER_COLLECTORS and not args.skip_collect:
        engine = create_engine(args.database_url or DEFAULT_DATABASE_URL)
        # The session is opened, read and closed before the browser starts. A run can take
        # ten minutes, and holding a SQLite connection across it would lock the database
        # against the API serving the screen the whole time.
        with sessionmaker(engine)() as session:
            checkpoint = session.get(Checkpoint, collector_id)
            last_seen = checkpoint.last_seen_code if checkpoint else None
            gate = _gate(session, collector_id)
        engine.dispose()

        child = _child_argv(collector_id, last_seen, args.seed_limit)

        if args.dry_run:
            _emit(
                event="dry_run",
                collector=collector_id,
                last_seen=last_seen,
                mode="incremental" if last_seen else "seed",
                gate=gate,
                would_run=child,
            )
            return 0

        if gate is not None:
            _emit(
                event="held",
                collector=collector_id,
                why=gate,
                # The command a person runs to clear it, which is this job's own shape
                # without the driver — so the line printed for `instagram_likes` is
                # `probe collect`, not a `--surface` this collector has never had.
                clear_with=" ".join(
                    [
                        "uv run probe",
                        COLLECTOR_SHAPES[collector_id].subcommand,
                        *COLLECTOR_SHAPES[collector_id].subject,
                    ]
                ),
            )
            collect_rc = EXIT_GATED
        else:
            # `check=False`: every outcome this child reports is already recorded in the
            # capture file it wrote, and a non-zero exit is information to log, never a
            # reason to run it again. `CLAUDE.md` §7 — do not retry aggressively.
            completed = subprocess.run(child, check=False, timeout=1800)  # noqa: S603
            collect_rc = completed.returncode
            _emit(event="collect", collector=collector_id, exit=collect_rc)
    elif args.dry_run:
        _emit(event="dry_run", collector=collector_id, mode="ingest_only")
        return 0

    # Always, whatever happened above.
    ingest_argv = ["--collector", collector_id, "--limit", str(args.media_limit)]
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

    if not args.no_classify:
        _classify_pending(args.database_url)
    return collect_rc


def _classify_pending(database_url: str | None) -> None:
    """Classify the liked posts that are waiting for a board.

    **This runs unattended, and that is the user's decision (2026-08-12).** It was a printed
    reminder first, on the reasoning that a timer cannot be the party that authorises content
    leaving the machine. The user overrode it: the reminder made the whole feature manual in
    practice, since an inbox nobody has classified is an inbox nobody can read.

    What the earlier reasoning got right is still true and is now handled here rather than by
    declining to run:

    * **The transmission is bounded by construction, not by supervision.** `BoardInput` has
      two string fields and `build_prompt` is the only path to a payload, so what leaves is
      the caption and the alt text, redacted — never a permalink, a handle, an id or an
      image. A person watching would not have made that smaller.
    * **Nothing is re-sent.** A decided row is never asked again, including a declined one:
      that is why `"none"` is stored rather than left null. A hung cycle costs one attempt,
      not a repeat of the corpus.
    * **It is capped.** `_CLASSIFY_LIMIT` bounds one cycle, so a backlog is worked off over
      several rather than becoming one enormous send.
    * **It is refusable.** `--no-classify` skips it, and the plists are regenerated from
      `api/launchd.py`, so turning it off is an edit and a reinstall rather than a hunt.

    A failure here never fails the cycle. Collection and ingestion have already happened by
    the time this runs, and an unclassified row is a row on no board — recoverable next
    cycle, which is the property that made the manual version safe too.
    """
    from ..enrich.classify import classify_boards

    engine = create_engine(database_url or DEFAULT_DATABASE_URL)
    try:
        with sessionmaker(engine)() as session:
            report = classify_boards(session, limit=_CLASSIFY_LIMIT)
    except Exception as error:
        # The captions are already in the database and still unclassified, so the next cycle
        # picks them up — a failure here is never a failure of the cycle. Naming the type and
        # nothing else keeps a caption out of the log (`docs/SECURITY_BOUNDARIES.md`).
        _emit(event="classify_failed", detail=type(error).__name__)
    else:
        _emit(event="classified", **report.as_dict())
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
