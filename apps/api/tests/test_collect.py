"""One scheduled cycle, with the browser replaced by a function that writes a file.

`ingest.collect` is what a launchd job runs, and everything it decides happens either side
of a process it never looks inside: it reads the checkpoint, decides whether this collector
may be opened at all, hands the position over as an argv string, and then ingests every
capture file on disk — including the one a child wrote to say it could not get in.

That seam is what makes this file possible. The child here is a `subprocess.run` that runs
nothing: no browser, no profile, no account, no network. Nor does anything land in the
repository's own `var/` tree — the ingest lock and the media cache are both pointed
somewhere under `tmp_path` before a test starts.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.today import build_today
from taste_inbox.db.models import Base, Checkpoint, CollectorRun, Item
from taste_inbox.ingest import cli as ingest_cli
from taste_inbox.ingest import collect
from taste_inbox.ingest.media import MediaReport

#: Fixed, because `_gate` orders runs on this column and Today reads it back onto a day.
STAMP = "2026-08-09T00:00:00Z"


class FakeChild:
    """`subprocess.run`, minus the process.

    Records every argv `main` decided on, and can leave behind the capture file a real run
    would have written — which is the collector's only channel back into this package.
    """

    #: Children that are collectors, as opposed to the classifier the cycle also spawns.
    #:
    #: Split out on 2026-08-12, when the classifier joined the cycle and every "exactly one
    #: child" assertion became a statement about two different things at once.
    @property
    def collector_calls(self) -> list[list[str]]:
        return [argv for argv in self.calls if "claude" not in argv[0]]

    @property
    def classifier_calls(self) -> list[list[str]]:
        return [argv for argv in self.calls if "claude" in argv[0]]

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.returncode = 0
        self.capture: tuple[Path, dict[str, Any]] | None = None

    # `[Any]`, because this one fake stands in for two real children with different
    # `text=` settings: the collector's output is bytes and the classifier's is str.
    def __call__(self, argv: list[str], **_: object) -> subprocess.CompletedProcess[Any]:
        self.calls.append(list(argv))
        if self.capture is not None:
            path, payload = self.capture
            path.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        # `stdout=""` rather than the default `None`: since 2026-08-12 the cycle also spawns
        # the classifier, whose reader does `raw.find("{")`. A `None` here raised
        # `AttributeError` inside `classify_boards`, which the cycle then swallowed as
        # `classify_failed` — a fake that fails in a way no real process does.
        return subprocess.CompletedProcess(list(argv), self.returncode, stdout="")

    @property
    def argv(self) -> list[str]:
        assert len(self.collector_calls) == 1, (
            f"expected exactly one collector child, got {self.collector_calls}"
        )
        return self.calls[0]


def _no_media(_session: Session, **_: object) -> MediaReport:
    """The media step, minus the machine.

    `cache_pending` resolves its budget by detecting this Mac, then sweeps `var/media`
    against whatever the database happens to reference. Neither belongs in a test about the
    driver, and `tests/helpers.py` is the standing rule that the suite never reads the host
    it is running on.
    """
    return MediaReport()


@pytest.fixture
def database(tmp_path: Path) -> str:
    """A file, not `sqlite://`.

    `main` opens its own engine from this URL, reads the checkpoint and closes it again
    before the browser starts — so an in-memory database would hand it an empty one instead
    of the rows a test just wrote.
    """
    url = f"sqlite:///{tmp_path / 'taste-inbox.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    engine.dispose()
    return url


@pytest.fixture
def session(database: str) -> Iterator[Session]:
    engine = create_engine(database)
    with sessionmaker(engine)() as active:
        yield active
    engine.dispose()


@pytest.fixture(autouse=True)
def child(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> FakeChild:
    """Autouse, because the escapes it closes are on the default path.

    A test that forgot to ask for it would start a real collector against a real account.
    The same fixture redirects the two other things a cycle reaches for outside the
    database: the interpreter the child would be started with, and the ingest lock, which
    `_ingest_lock` opens under the repository's real `var/run`.
    """
    fake = FakeChild()
    # The stdlib module object, which is the one `collect` calls through — so this replaces
    # `subprocess.run` for the whole process while a test runs. That is the intent: the
    # cycle must not be able to start anything at all, by any route.
    monkeypatch.setattr(subprocess, "run", fake)
    # The same boundary must cover the availability probe. A developer machine without a
    # real Claude CLI should exercise the fake subprocess exactly like one that has it.
    monkeypatch.setattr("taste_inbox.enrich.classify.shutil.which", lambda binary: binary)
    monkeypatch.setenv("TASTE_INBOX_COLLECTOR_PYTHON", str(tmp_path / "collector-python"))
    monkeypatch.setattr(collect, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(ingest_cli, "cache_pending", _no_media)
    return fake


def run_cycle(session: Session, database: str, captures: Path, collector: str, *extra: str) -> int:
    """One `main`, then forget what this session already read.

    `main` writes through an engine of its own, so every row this session loaded before the
    call is stale by the time it returns.
    """
    code = collect.main(
        [
            "--collector",
            collector,
            "--captures",
            str(captures),
            "--database-url",
            database,
            *extra,
        ]
    )
    session.expire_all()
    return code


def seed_checkpoint(
    session: Session,
    collector_id: str,
    *,
    last_seen_code: str | None = None,
    last_outcome: str = "ok",
) -> None:
    session.add(
        Checkpoint(
            collector_id=collector_id,
            last_seen_code=last_seen_code,
            last_outcome=last_outcome,
            updated_at=STAMP,
        )
    )
    session.commit()


def seed_runs(session: Session, collector_id: str, *outcomes: str) -> None:
    """Newest last. `_gate` reads the most recent `AUTH_PATIENCE` rows by `started_at`."""
    for hour, outcome in enumerate(outcomes):
        session.add(
            CollectorRun(
                collector_id=collector_id,
                outcome=outcome,
                started_at=f"2026-08-09T{hour:02d}:00:00Z",
            )
        )
    session.commit()


def write_capture(directory: Path, name: str, payload: object) -> None:
    (directory / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False), "utf-8")


def collected_capture(surface: str, item_id: str) -> dict[str, Any]:
    """A capture already on disk, so that "ingestion ran" is a row rather than a log line."""
    return {
        "run": {
            "surface": surface,
            "outcome": "ok",
            "started_at": STAMP,
            "scroll_passes": 0,
            "exhausted": False,
            "checkpoint": item_id,
            "advanced_checkpoint": True,
            "stopped_because": "collected the requested newest items",
            "notes": [],
        },
        "items": [
            {
                "platform_item_id": item_id,
                "canonical_url": f"https://example.test/{item_id}",
                "kind": "post",
                "title": item_id,
                "body_text": None,
                "owner": "someone",
                "tags": [],
                "outbound_urls": [],
            }
        ],
    }


def instagram_item(code: str) -> dict[str, Any]:
    """The smallest saved post `ingest_instagram_file` accepts, and nothing more.

    Only here to prove ingestion ran for a collector this driver never spawns a child for.
    """
    return {
        "code": code,
        "media_type": "video",
        "product_type": "clips",
        "taken_at": 1757736341,
        "owner": "someone",
        "caption": "본문",
        "thumbnail_url": None,
    }


def walled_capture(surface: str) -> dict[str, Any]:
    """What the child writes when the surface answers with a login form.

    The shape is the collector's, not this test's: a run that reports itself, no checkpoint
    to move, and items that are honestly empty.
    """
    return {
        "run": {
            "surface": surface,
            "outcome": "auth_required",
            "started_at": "2026-08-09T12:57:14+00:00",
            "scroll_passes": 0,
            "exhausted": False,
            "checkpoint": None,
            "advanced_checkpoint": False,
            "stopped_because": "the page asked for a login",
            "notes": [],
        },
        "items": [],
    }


def emitted(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    """The driver's own JSON lines.

    `ingest.cli` prints an indented report onto the same stream, so only whole-line objects
    are read back — every fragment of the indented one fails to parse.
    """
    events: list[dict[str, Any]] = []
    for line in capsys.readouterr().out.splitlines():
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            events.append(parsed)
    return events


def item_count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Item)) or 0


class TestTheChildArgv:
    """The checkpoint crosses the package boundary as a string and comes back as a file.

    Nothing else travels. `apps/api` cannot import a collector and `services/collectors`
    cannot see the database, so an argv that names the wrong flag is not a type error
    anywhere — it is a collector that seeds from the top of the list every four hours.
    """

    def test_a_stored_checkpoint_is_handed_to_the_child_as_where_to_stop(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        seed_checkpoint(session, "github_stars", last_seen_code="a/b")

        assert run_cycle(session, database, tmp_path, "github_stars") == 0

        assert child.argv[-2:] == ["--last-seen", "a/b"]
        # `--limit` is the seeding cap. Sending both would ask an incremental run to stop
        # after five items and never reach the checkpoint it was given.
        assert "--limit" not in child.argv

    def test_no_checkpoint_row_at_all_is_a_seeding_run(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        assert run_cycle(session, database, tmp_path, "github_stars") == 0

        assert child.argv[-2:] == ["--limit", "5"]
        assert "--last-seen" not in child.argv

    def test_a_checkpoint_row_that_never_recorded_a_position_is_also_a_seeding_run(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # The state a failed first run leaves behind: `last_outcome` was written, but
        # nothing was collected, so there is no position to resume from. Passing an empty
        # `--last-seen` would tell the child to walk the whole list looking for "".
        seed_checkpoint(session, "github_stars", last_seen_code=None, last_outcome="auth_required")

        assert run_cycle(session, database, tmp_path, "github_stars") == 0

        assert child.argv[-2:] == ["--limit", "5"]
        assert "--last-seen" not in child.argv

    def test_names_the_surface_and_the_subcommand_that_can_run_unattended(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # `sources` is the only collector subcommand that takes no person. The others open
        # a window and wait for one.
        assert run_cycle(session, database, tmp_path, "linkedin_reactions") == 0

        assert child.argv[1:6] == [
            "-m",
            "taste_inbox_collectors.cli",
            "sources",
            "--surface",
            "linkedin_reactions",
        ]

    def test_starts_the_interpreter_the_plist_names_rather_than_this_one(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # This venv has neither playwright nor `taste_inbox_collectors` in it, and launchd
        # resolves nothing from a near-empty environment.
        assert run_cycle(session, database, tmp_path, "github_stars") == 0

        assert child.argv[0] == str(tmp_path / "collector-python")


class TestGates:
    """Two refusals with deliberately different tempers.

    A challenge is the platform saying stop, and CLAUDE.md §7 forbids retrying it. A
    logged-out session is ordinary, self-inflicted and costs one page load to test — so it
    is worth a few more cycles before a timer gives up on it.
    """

    def test_a_blocked_collector_is_never_opened_again_by_a_timer(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        seed_checkpoint(session, "github_stars", last_seen_code="a/b", last_outcome="blocked")
        write_capture(tmp_path, "threads_reposts", collected_capture("threads_reposts", "post-1"))

        code = run_cycle(session, database, tmp_path, "github_stars")

        assert child.calls == []
        assert code == collect.EXIT_GATED
        # Held, not skipped: ingestion runs last and always, so a capture on disk is still
        # read and a hand-run `probe sources` can still clear the gate this cycle set.
        assert item_count(session) == 1

    def test_a_gate_says_which_command_clears_it(
        self, session: Session, database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # The only way out is a person, so the log line has to name what they should run.
        seed_checkpoint(session, "github_stars", last_outcome="blocked")

        run_cycle(session, database, tmp_path, "github_stars")

        held = next(event for event in emitted(capsys) if event["event"] == "held")
        assert held["clear_with"] == "uv run probe sources --surface github_stars"

    def test_one_login_wall_is_tried_again_next_cycle(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # `uv run probe login` has to be a sufficient fix. Gating here would mean a second
        # command to clear a flag, which nobody would remember was set.
        seed_checkpoint(session, "github_stars", last_seen_code="a/b", last_outcome="auth_required")
        seed_runs(session, "github_stars", "auth_required")

        code = run_cycle(session, database, tmp_path, "github_stars")

        assert len(child.calls) == 1
        assert code == 0

    def test_three_login_walls_gate_where_one_challenge_gates_immediately(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # The asymmetry is the product decision: patience for a state the user can fix by
        # logging in, none at all for one the platform imposed. A session nobody has
        # repaired by the third cycle is a person's job, not a timer's.
        seed_checkpoint(session, "github_stars", last_seen_code="a/b", last_outcome="auth_required")
        seed_runs(session, "github_stars", "auth_required", "auth_required", "auth_required")

        code = run_cycle(session, database, tmp_path, "github_stars")

        assert child.calls == []
        assert code == collect.EXIT_GATED

    def test_three_login_walls_with_a_good_run_between_them_are_not_consecutive(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # Counting walls instead of consecutive walls would retire a collector that has
        # been working fine since, on the strength of a bad week last month.
        seed_checkpoint(session, "github_stars", last_seen_code="a/b", last_outcome="auth_required")
        seed_runs(session, "github_stars", "auth_required", "ok", "auth_required")

        assert run_cycle(session, database, tmp_path, "github_stars") == 0
        assert len(child.calls) == 1


class TestIngestionRunsWhateverElseHappened:
    def test_community_distribution_never_starts_a_browser_but_still_imports_captures(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        from taste_inbox.distribution import COMMUNITY_MARKER

        (tmp_path / COMMUNITY_MARKER).touch()
        write_capture(tmp_path, "threads_reposts", collected_capture("threads_reposts", "post-1"))

        code = run_cycle(session, database, tmp_path, "github_stars")

        assert code == collect.EXIT_DISTRIBUTION_REFUSED
        assert child.calls == []
        assert item_count(session) == 1
        refused = next(
            event for event in emitted(capsys) if event["event"] == "distribution_refused"
        )
        assert refused["collector"] == "github_stars"

    def test_an_instagram_job_collects_nothing_and_says_so_by_not_trying(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # Instagram stopped serving named collections on the web on 2026-08-09, so those
        # boards are filled by `probe saved` run by hand. A job that spawned a child here
        # would report success for work no collector can currently do.
        write_capture(tmp_path, "saved-ai", [instagram_item("AAA")])

        assert run_cycle(session, database, tmp_path, "instagram_saved_ai") == 0

        assert child.calls == []
        assert item_count(session) == 1

    def test_skip_collect_reads_what_is_already_on_disk(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        write_capture(tmp_path, "github_stars", collected_capture("github_stars", "a/b"))

        assert run_cycle(session, database, tmp_path, "github_stars", "--skip-collect") == 0

        assert child.calls == []
        assert item_count(session) == 1

    def test_a_child_that_failed_still_leaves_the_cycle_ingesting(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # A non-zero exit is information to log, never a reason to skip the rest: whatever
        # the child managed to write before it stopped is on disk and belongs in the
        # database. The code is passed through so the log says which cycle went wrong.
        child.returncode = collect.EXIT_INGEST_FAILED - 1
        write_capture(tmp_path, "threads_reposts", collected_capture("threads_reposts", "post-1"))

        code = run_cycle(session, database, tmp_path, "github_stars")

        assert code == child.returncode
        assert item_count(session) == 1


class TestDryRun:
    def test_community_dry_run_is_a_read_only_refusal(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        from taste_inbox.distribution import COMMUNITY_MARKER

        (tmp_path / COMMUNITY_MARKER).touch()
        write_capture(tmp_path, "threads_reposts", collected_capture("threads_reposts", "post-1"))

        assert run_cycle(session, database, tmp_path, "github_stars", "--dry-run") == 0

        assert child.calls == []
        assert item_count(session) == 0
        assert emitted(capsys)[0]["mode"] == "distribution_refused"

    def test_prints_the_checkpoint_and_the_argv_and_starts_nothing(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        seed_checkpoint(session, "github_stars", last_seen_code="a/b")
        write_capture(tmp_path, "threads_reposts", collected_capture("threads_reposts", "post-1"))

        assert run_cycle(session, database, tmp_path, "github_stars", "--dry-run") == 0

        assert child.calls == []
        event = emitted(capsys)[0]
        assert event["event"] == "dry_run"
        assert event["last_seen"] == "a/b"
        assert event["mode"] == "incremental"
        assert event["would_run"][-2:] == ["--last-seen", "a/b"]
        # "changes nothing" includes the database: the capture beside it stays unread.
        assert item_count(session) == 0

    def test_says_when_a_collector_would_only_have_ingested(
        self, session: Session, database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        assert run_cycle(session, database, tmp_path, "instagram_saved_ai", "--dry-run") == 0

        assert emitted(capsys)[0]["mode"] == "ingest_only"


class TestOneWholeCycle:
    """launchd's argv to a lit-up screen, with no browser anywhere in it.

    Every seam in the design is exercised once here: the checkpoint read from the database,
    handed out as a flag, and the run's outcome coming back as a file that ingestion turns
    into the one field the Today screen counts.
    """

    def test_a_login_wall_travels_from_the_child_s_capture_file_to_today(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        seed_checkpoint(session, "github_stars", last_seen_code="a/b")
        child.capture = (tmp_path / "github_stars.json", walled_capture("github_stars"))

        assert run_cycle(session, database, tmp_path, "github_stars") == 0

        assert child.argv[-2:] == ["--last-seen", "a/b"]
        checkpoint = session.get(Checkpoint, "github_stars")
        assert checkpoint is not None
        assert checkpoint.last_outcome == "auth_required"
        # A run that could not get in saw nothing, so it knows nothing about where the list
        # now starts. Moving the position here would skip everything above it, permanently.
        assert checkpoint.last_seen_code == "a/b"

        today = build_today(session)
        assert today["counts"]["attention"] == 1
        github = next(
            row for row in today["sourceStatusSummary"]["sources"] if row["platform"] == "github"
        )
        assert github["state"] == "auth_required"

    def test_the_wall_is_the_run_the_next_cycle_counts_towards_its_patience(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # The capture file is also how `_gate` learns anything at all: a login wall that
        # never became a `collector_runs` row would leave the timer knocking forever.
        seed_checkpoint(session, "github_stars", last_seen_code="a/b")
        child.capture = (tmp_path / "github_stars.json", walled_capture("github_stars"))

        run_cycle(session, database, tmp_path, "github_stars")

        outcomes = list(
            session.scalars(
                select(CollectorRun.outcome).where(CollectorRun.collector_id == "github_stars")
            )
        )
        assert outcomes == ["auth_required"]


def likes_capture(
    *, code: str, checkpoint: str | None, advanced: bool, started_at: str = STAMP
) -> dict[str, Any]:
    """What `probe collect` writes: the same `{run, items}` envelope every capture uses.

    Timestamped rather than fixed-name on disk, and that is the only thing about it the
    ingester treats differently — the run inside is read by exactly the same `_record_run`
    the browser surfaces go through.
    """
    return {
        "run": {
            "outcome": "ok",
            "started_at": started_at,
            "tiles_seen": 4,
            "tiles_opened": 1,
            "checkpoint": checkpoint,
            "advanced_checkpoint": advanced,
            "exhausted": False,
            "stopped_because": "reached the last-seen checkpoint",
            "notes": [],
        },
        "items": [
            {
                "code": code,
                "permalink": f"https://www.instagram.com/p/{code}/",
                "first_seen_at": "2026-08-09T00:00:00+00:00",
                "media_type": "image",
                "product_type": None,
                "taken_at": 1757736341,
                "caption": "좋아요 누른 게시물",
                "accessibility_caption": None,
                "audio_title": None,
                "audio_artist": None,
            }
        ],
    }


class TestTheLikesShape:
    """The second collector shape, and the reason `COLLECTOR_SHAPES` is a table.

    `probe sources --surface <id>` and `probe collect` are different subcommands taking
    different arguments and writing differently named files. Everything after the argv is
    built is identical — same checkpoint table, same gate, same ingest — so what these
    assert is that only the argv differs.
    """

    def test_the_likes_job_runs_probe_collect_and_names_no_surface(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # `--surface` is `sources`' way of choosing between three lists. `collect` has one
        # subject — the Likes grid — and passing it a surface would be an argparse error
        # every four hours.
        assert run_cycle(session, database, tmp_path, "instagram_likes") == 0

        assert child.argv[1:4] == ["-m", "taste_inbox_collectors.cli", "collect"]
        assert "--surface" not in child.argv

    def test_a_stored_checkpoint_is_handed_over_with_a_cap_on_the_tiles(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        """Unlike `sources`, an incremental Likes run still needs a limit.

        `sources` scrolls a list and stops when the last-seen id reappears. `collect` has to
        *open a post per item* — the grid is a Bloks surface whose tiles carry no permalink —
        so a run whose checkpoint has gone missing (the post was unliked) would otherwise
        walk the entire history one overlay at a time.
        """
        seed_checkpoint(session, "instagram_likes", last_seen_code="DNhq3ykDaSK")

        assert run_cycle(session, database, tmp_path, "instagram_likes") == 0

        assert "--last-seen" in child.argv
        assert child.argv[child.argv.index("--last-seen") + 1] == "DNhq3ykDaSK"
        assert child.argv[child.argv.index("--limit") + 1] == "40"

    def test_no_checkpoint_is_a_seeding_run_at_the_shared_seed_limit(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # The seeding rule is the one thing both shapes share: with no checkpoint, take the
        # newest `--seed-limit` and nothing older.
        assert run_cycle(session, database, tmp_path, "instagram_likes") == 0

        assert child.argv[-2:] == ["--limit", "5"]
        assert "--last-seen" not in child.argv

    def test_a_gate_names_the_command_this_shape_is_cleared_with(
        self, session: Session, database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # `probe collect`, not a `--surface` this collector has never had. The line exists
        # for a person to run, so a wrong one is worse than none.
        seed_checkpoint(session, "instagram_likes", last_outcome="blocked")

        run_cycle(session, database, tmp_path, "instagram_likes")

        held = next(event for event in emitted(capsys) if event["event"] == "held")
        assert held["clear_with"] == "uv run probe collect"

    def test_the_capture_the_child_writes_becomes_the_stored_checkpoint(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        """The checkpoint travels back as a file, exactly as it does for the browser jobs.

        This is the whole reason the Likes capture gained a run envelope. Before it, the
        position lived in a line of terminal output that a person had to copy into the next
        run — which cannot be a schedule.
        """
        child.capture = (
            tmp_path / "instagram-collect-20260809T000000Z.json",
            likes_capture(code="AAA111", checkpoint="AAA111", advanced=True),
        )

        assert run_cycle(session, database, tmp_path, "instagram_likes") == 0

        checkpoint = session.get(Checkpoint, "instagram_likes")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "AAA111"
        assert checkpoint.last_outcome == "ok"
        assert item_count(session) == 1

    def test_the_next_cycle_hands_that_checkpoint_straight_back(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # The loop closed end to end: collect → capture → ingest → checkpoint → next argv.
        child.capture = (
            tmp_path / "instagram-collect-20260809T000000Z.json",
            likes_capture(code="AAA111", checkpoint="AAA111", advanced=True),
        )
        run_cycle(session, database, tmp_path, "instagram_likes")
        child.calls.clear()
        child.capture = None

        run_cycle(session, database, tmp_path, "instagram_likes")

        assert child.argv[child.argv.index("--last-seen") + 1] == "AAA111"

    def test_a_run_that_stopped_early_ingests_its_items_without_moving_the_mark(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # `advanced_checkpoint: false` is the collector saying "I did not reach the previous
        # mark". Moving it anyway would skip everything in the gap for good.
        seed_checkpoint(session, "instagram_likes", last_seen_code="OLD")
        child.capture = (
            tmp_path / "instagram-collect-20260809T000000Z.json",
            likes_capture(code="BBB222", checkpoint="BBB222", advanced=False),
        )

        assert run_cycle(session, database, tmp_path, "instagram_likes") == 0

        checkpoint = session.get(Checkpoint, "instagram_likes")
        assert checkpoint is not None
        assert checkpoint.last_seen_code == "OLD"
        assert item_count(session) == 1


class TestTheClassifierRunsOnTheCycle:
    """The cycle classifies, and what bounds it.

    This class used to be `TestTheClassifierStaysAHumanCommand` and asserted the opposite:
    that a cycle never spawns `claude`. That was the right default and the user overrode it
    on 2026-08-12 — a printed reminder made the feature manual in practice, since an inbox
    nobody classified is an inbox nobody can read.

    So the tests invert, and what they now pin is the part that replaced supervision: the
    send is capped, refusable, and never repeated.
    """

    def test_the_cycle_spawns_the_classifier(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        (tmp_path / "instagram-collect-20260809T000000Z.json").write_text(
            json.dumps(likes_capture(code="CCC333", checkpoint="CCC333", advanced=True)), "utf-8"
        )

        run_cycle(session, database, tmp_path, "instagram_likes", "--skip-collect")

        assert child.classifier_calls, "an undecided liked post should have been classified"

    def test_the_send_is_capped(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # A backlog drains over several cycles rather than becoming one enormous send.
        from taste_inbox.ingest.collect import _CLASSIFY_LIMIT

        assert _CLASSIFY_LIMIT > 0

    def test_no_classify_refuses_the_send(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        """Turning it off must not mean editing code.

        This is the whole of the opt-out, so it is the one thing here that would be worst to
        have only in a docstring — which is where it lived for about ten minutes.
        """
        (tmp_path / "instagram-collect-20260809T000000Z.json").write_text(
            json.dumps(likes_capture(code="CCC333", checkpoint="CCC333", advanced=True)), "utf-8"
        )

        run_cycle(session, database, tmp_path, "instagram_likes", "--skip-collect", "--no-classify")

        assert not child.classifier_calls, "--no-classify must send nothing"

    def test_a_classifier_failure_does_not_fail_the_cycle(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # Collection and ingestion have already happened by then, and an unclassified row is
        # a row on no board — recoverable next cycle. It must not cost the collected items.
        (tmp_path / "instagram-collect-20260809T000000Z.json").write_text(
            json.dumps(likes_capture(code="CCC333", checkpoint="CCC333", advanced=True)), "utf-8"
        )
        child.returncode = 1

        code = run_cycle(session, database, tmp_path, "instagram_likes", "--skip-collect")

        assert code == 0, "a classifier that failed must not fail the cycle"
