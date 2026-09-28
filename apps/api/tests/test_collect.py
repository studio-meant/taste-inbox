"""One scheduled cycle, with the collector replaced by a function that writes a file.

`ingest.collect` is what a launchd job and the in-app scheduler run, and everything it
decides happens either side of a process it never looks inside: it reads the checkpoint and
the account name, hands both over as argv, and then ingests every capture file on disk —
including the one a child wrote to say it could not collect.

That seam is what makes this file possible. The child here is a `subprocess.run` that runs
nothing: no network, no account. Nor does anything land in the repository's own `var/`
tree — the ingest lock is pointed under `tmp_path` before a test starts.
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

from taste_inbox.api import accounts
from taste_inbox.api.accounts import SEED_LIMIT
from taste_inbox.api.today import build_today
from taste_inbox.db.models import Base, Checkpoint, Item
from taste_inbox.ingest import collect

STAMP = "2026-09-28T00:00:00Z"


class FakeChild:
    """`subprocess.run`, minus the process.

    Records every argv `main` decided on, and can leave behind the capture file a real run
    would have written — which is the collector's only channel back into this package.
    """

    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.returncode = 0
        self.capture: tuple[Path, dict[str, Any]] | None = None

    def __call__(self, argv: list[str], **_: object) -> subprocess.CompletedProcess[Any]:
        self.calls.append(list(argv))
        if self.capture is not None:
            path, payload = self.capture
            path.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        return subprocess.CompletedProcess(list(argv), self.returncode, stdout="")

    @property
    def argv(self) -> list[str]:
        assert len(self.calls) == 1, f"expected exactly one child, got {self.calls}"
        return self.calls[0]


@pytest.fixture
def database(tmp_path: Path) -> str:
    """A file, not `sqlite://`.

    `main` opens its own engine from this URL, reads the checkpoint and closes it again
    before the child starts — so an in-memory database would hand it an empty one instead
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
    The same fixture redirects the interpreter the child would be started with and the
    ingest lock, which `_ingest_lock` opens under the repository's real `var/run`.
    """
    fake = FakeChild()
    monkeypatch.setattr(subprocess, "run", fake)
    monkeypatch.setenv("TASTE_INBOX_COLLECTOR_PYTHON", str(tmp_path / "collector-python"))
    monkeypatch.delenv("GITHUB_LOGIN", raising=False)
    monkeypatch.delenv("HF_USERNAME", raising=False)
    monkeypatch.setattr(collect, "REPO_ROOT", tmp_path)
    return fake


def run_cycle(session: Session, database: str, captures: Path, collector: str, *extra: str) -> int:
    """One `main`, then forget what this session already read."""
    code = collect.main(
        ["--collector", collector, "--captures", str(captures), "--database-url", database, *extra]
    )
    session.expire_all()
    return code


def connect(session: Session, platform: str, handle: str = "ohsuz") -> None:
    accounts.connect(session, platform, handle)
    session.commit()


def seed_checkpoint(session: Session, collector_id: str, last_seen_code: str | None) -> None:
    session.add(
        Checkpoint(
            collector_id=collector_id,
            last_seen_code=last_seen_code,
            last_outcome="ok",
            updated_at=STAMP,
        )
    )
    session.commit()


def capture(surface: str, *, outcome: str = "ok", item_id: str | None = None) -> dict[str, Any]:
    """What a collector writes: a run that reports itself, and the items it found."""
    return {
        "run": {
            "surface": surface,
            "outcome": outcome,
            "started_at": STAMP,
            "scroll_passes": 1,
            "exhausted": outcome == "ok",
            "checkpoint": item_id,
            "advanced_checkpoint": outcome == "ok" and item_id is not None,
            "stopped_because": "" if outcome == "ok" else "업보트 응답의 모양이 바뀌었어요",
            "notes": [],
        },
        "items": []
        if item_id is None
        else [
            {
                "platform": "github",
                "platform_item_id": item_id,
                "canonical_url": f"https://github.com/someone/{item_id}",
                "kind": "repo",
                "title": f"someone/{item_id}",
                "tags": [],
                "outbound_urls": [],
            }
        ],
    }


def write_capture(directory: Path, name: str, payload: object) -> None:
    (directory / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False), "utf-8")


def emitted(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    """The driver's own JSON lines, skipping the indented report `ingest.cli` prints."""
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
    def test_a_stored_checkpoint_is_handed_over_as_where_to_stop(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        connect(session, "github")
        seed_checkpoint(session, "github_stars_api", "1234")

        run_cycle(session, database, tmp_path, "github_stars_api")

        assert child.argv[-6:] == [
            "--source",
            "github_stars_api",
            "--account",
            "ohsuz",
            "--last-seen",
            "1234",
        ]

    def test_no_checkpoint_is_a_bounded_seeding_run(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # A first run must not walk a whole history of stars.
        connect(session, "huggingface")

        run_cycle(session, database, tmp_path, "huggingface_upvotes")

        assert child.argv[-2:] == ["--limit", str(SEED_LIMIT["huggingface_upvotes"])]
        assert "--last-seen" not in child.argv

    def test_starts_the_interpreter_that_can_import_a_collector(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        connect(session, "github")

        run_cycle(session, database, tmp_path, "github_stars_api")

        assert child.argv[:4] == [
            str(tmp_path / "collector-python"),
            "-m",
            "taste_inbox_collectors.cli",
            "api",
        ]

    def test_the_environment_names_the_account_when_settings_does_not(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setenv("GITHUB_LOGIN", "from-env")

        run_cycle(session, database, tmp_path, "github_stars_api")

        assert child.argv[child.argv.index("--account") + 1] == "from-env"


class TestWithoutAnAccount:
    def test_nothing_is_started_and_the_cycle_says_why(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        code = run_cycle(session, database, tmp_path, "huggingface_activity")

        assert code == collect.EXIT_GATED
        assert child.calls == []
        event = next(e for e in emitted(capsys) if e["event"] == "not_connected")
        assert "Settings" in event["why"]


class TestIngestionRunsWhateverElseHappened:
    def test_a_distribution_without_collection_still_imports_what_is_on_disk(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        # A damaged marker grants nothing, and a capture already on disk is still local
        # data this cycle reads.
        (tmp_path / ".taste-inbox-community").write_text("{", "utf-8")
        connect(session, "github")
        write_capture(tmp_path, "github_stars_api", capture("github_stars_api", item_id="1"))

        code = run_cycle(session, database, tmp_path, "github_stars_api")

        assert code == collect.EXIT_DISTRIBUTION_REFUSED
        assert child.calls == []
        assert item_count(session) == 1

    def test_skip_collect_reads_what_is_already_on_disk(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        connect(session, "github")
        write_capture(tmp_path, "github_stars_api", capture("github_stars_api", item_id="1"))

        assert run_cycle(session, database, tmp_path, "github_stars_api", "--skip-collect") == 0

        assert child.calls == []
        assert item_count(session) == 1

    def test_a_child_that_failed_still_leaves_the_cycle_ingesting(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        connect(session, "github")
        child.returncode = 2
        child.capture = (
            tmp_path / "github_stars_api.json",
            capture("github_stars_api", item_id="7"),
        )

        assert run_cycle(session, database, tmp_path, "github_stars_api") == 2

        assert item_count(session) == 1


class TestDryRun:
    def test_prints_the_checkpoint_and_the_argv_and_starts_nothing(
        self,
        session: Session,
        database: str,
        tmp_path: Path,
        child: FakeChild,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        connect(session, "github")
        seed_checkpoint(session, "github_stars_api", "1234")

        assert run_cycle(session, database, tmp_path, "github_stars_api", "--dry-run") == 0

        assert child.calls == []
        [event] = emitted(capsys)
        assert event["mode"] == "incremental"
        assert event["last_seen"] == "1234"
        assert event["would_run"][-2:] == ["--last-seen", "1234"]

    def test_says_when_there_is_no_account_to_collect(
        self, session: Session, database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        run_cycle(session, database, tmp_path, "huggingface_upvotes", "--dry-run")
        assert emitted(capsys) == [
            {"event": "dry_run", "collector": "huggingface_upvotes", "mode": "not_connected"}
        ]

    def test_says_when_a_name_is_not_a_collector(
        self, session: Session, database: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        run_cycle(session, database, tmp_path, "instagram_likes", "--dry-run")
        assert emitted(capsys) == [
            {"event": "dry_run", "collector": "instagram_likes", "mode": "ingest_only"}
        ]


class TestOneWholeCycle:
    def test_a_stopped_collector_travels_from_its_capture_file_to_today(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        """The upvote reader meeting a changed shape writes `failed` — and Today says so."""
        connect(session, "huggingface")
        child.capture = (
            tmp_path / "huggingface_upvotes.json",
            capture("huggingface_upvotes", outcome="failed"),
        )

        run_cycle(session, database, tmp_path, "huggingface_upvotes")

        checkpoint = session.get(Checkpoint, "huggingface_upvotes")
        assert checkpoint is not None
        assert checkpoint.last_outcome == "failed"
        # Nothing was collected, so the next run starts from the top.
        assert checkpoint.last_seen_code is None
        assert build_today(session)["counts"]["attention"] == 1

    def test_a_good_run_moves_the_checkpoint_the_next_cycle_hands_back(
        self, session: Session, database: str, tmp_path: Path, child: FakeChild
    ) -> None:
        connect(session, "github")
        child.capture = (
            tmp_path / "github_stars_api.json",
            capture("github_stars_api", item_id="42"),
        )
        run_cycle(session, database, tmp_path, "github_stars_api")
        child.capture = None

        run_cycle(session, database, tmp_path, "github_stars_api")

        assert child.calls[-1][-2:] == ["--last-seen", "42"]
