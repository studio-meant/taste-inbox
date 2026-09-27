"""Connecting a GitHub or Hugging Face account by name, and collecting it.

The collector itself never runs here: `run_job` takes it as an argument and the endpoints
reach it through `app._collect_surface`, both replaced with a function that writes what a
real run would have left in `collector_runs`.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api import accounts, background
from taste_inbox.api.app import app, get_session
from taste_inbox.db.models import Base, Checkpoint, CollectorRun, JobStep
from taste_inbox.ingest import collect

from .library import library

app_module = import_module("taste_inbox.api.app")


def _run(session: Session, surface: str, outcome: str = "ok", seen: int = 3, why: str = "") -> None:
    session.add(
        CollectorRun(
            collector_id=surface,
            outcome=outcome,
            started_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            finished_at=None,
            items_seen=seen,
            items_new=seen,
            stopped_because=why,
        )
    )
    session.commit()


# --- names -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("platform", "raw", "expected"),
    [
        ("github", "ohsuz", "ohsuz"),
        ("github", "@ohsuz", "ohsuz"),
        ("github", "https://github.com/ohsuz/", "ohsuz"),
        ("github", "github.com/ohsuz?tab=stars", "ohsuz"),
        ("huggingface", "https://huggingface.co/ohsuz/activity/upvotes", "ohsuz"),
        ("huggingface", "julien-c", "julien-c"),
        ("huggingface", "some.org_name", "some.org_name"),
    ],
)
def test_a_name_is_read_out_of_whatever_was_pasted(platform: str, raw: str, expected: str) -> None:
    assert accounts.normalise(platform, raw) == expected


@pytest.mark.parametrize(
    ("platform", "raw"),
    [
        ("github", ""),
        ("github", "oh suz"),
        ("github", "-ohsuz"),
        ("github", "oh--suz"),
        ("github", "a" * 40),
        ("huggingface", "../etc"),
        ("instagram", "ohsuz"),
    ],
)
def test_a_name_the_platform_could_not_have_issued_is_refused(platform: str, raw: str) -> None:
    with pytest.raises(accounts.AccountRejected):
        accounts.normalise(platform, raw)


def test_renaming_resets_only_that_platforms_checkpoints(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        accounts.connect(session, "huggingface", "first")
        for surface in ("huggingface_activity", "huggingface_upvotes", "github_stars_api"):
            session.merge(
                Checkpoint(
                    collector_id=surface, last_seen_code="x", updated_at="2026-09-28T00:00:00Z"
                )
            )
        session.commit()

        _, unchanged = accounts.connect(session, "huggingface", "@first")
        assert unchanged is False
        assert session.get(Checkpoint, "huggingface_upvotes") is not None

        _, changed = accounts.connect(session, "huggingface", "second")
        assert changed is True
        assert session.get(Checkpoint, "huggingface_activity") is None
        assert session.get(Checkpoint, "huggingface_upvotes") is None
        # Another platform's position is somebody else's listing.
        assert session.get(Checkpoint, "github_stars_api") is not None


def test_disconnecting_keeps_what_was_collected(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        accounts.connect(session, "github", "ohsuz")
        before = next(row for row in accounts.payload(session) if row["platform"] == "github")
        accounts.disconnect(session, "github")
        after = next(row for row in accounts.payload(session) if row["platform"] == "github")

    assert after["handle"] is None
    assert after["itemCount"] == before["itemCount"] > 0


# --- the collection job ----------------------------------------------------------------


def _collector(
    factory: sessionmaker[Session], outcomes: dict[str, str]
) -> Callable[[str, str], int]:
    def collect_one(surface: str, database_url: str) -> int:
        with factory() as session:
            outcome = outcomes.get(surface, "ok")
            _run(session, surface, outcome, why="" if outcome == "ok" else "no Hugging Face user")
        return 0 if outcomes.get(surface, "ok") == "ok" else 1

    return collect_one


def test_a_job_collects_every_surface_of_the_platform(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        job = accounts.open_job(session, "huggingface")
        state = accounts.run_job(
            session, "huggingface", job.id, database_url="unused", collector=_collector(factory, {})
        )
        steps = session.scalars(
            select(JobStep).where(JobStep.job_id == job.id).order_by(JobStep.ordinal)
        ).all()

    assert state == "succeeded"
    assert [step.label for step in steps] == [
        "좋아요 · 모델 · 데이터셋 · Space 가져오기",
        "업보트한 논문 가져오기",
    ]
    assert [step.message for step in steps] == ["3개 확인", "3개 확인"]


def test_one_failed_surface_is_partial_and_says_why(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        job = accounts.open_job(session, "huggingface")
        state = accounts.run_job(
            session,
            "huggingface",
            job.id,
            database_url="unused",
            collector=_collector(factory, {"huggingface_upvotes": "failed"}),
        )
        failed = session.get(JobStep, f"{job.id}-1")

    assert state == "partially_succeeded"
    assert failed is not None and failed.state == "failed"
    assert failed.message == "no Hugging Face user"


def test_a_connected_account_is_due_after_its_interval(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        assert accounts.due(session, "github", 4) is False  # not connected
        accounts.connect(session, "github", "ohsuz")
        assert accounts.due(session, "github", 4) is True  # never collected
        _run(session, "github_stars_api")
        assert accounts.due(session, "github", 4) is False
        later = datetime.now(UTC) + timedelta(hours=4, minutes=1)
        assert accounts.due(session, "github", 4, now=later) is True


# --- the scheduled driver ----------------------------------------------------------------


def test_the_driver_seeds_a_first_run_and_resumes_a_later_one() -> None:
    seed = collect._api_child_argv("huggingface_upvotes", "ohsuz", None)
    later = collect._api_child_argv("huggingface_upvotes", "ohsuz", "paper:2607.11699")

    assert seed[-6:] == ["--source", "huggingface_upvotes", "--account", "ohsuz", "--limit", "30"]
    assert later[-2:] == ["--last-seen", "paper:2607.11699"]


def test_the_driver_reads_the_name_settings_stored(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GITHUB_LOGIN", raising=False)
    url = f"sqlite:///{tmp_path / 'db.sqlite'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine)

    collect.main(["--collector", "github_stars_api", "--database-url", url, "--dry-run"])
    assert json.loads(capsys.readouterr().out)["mode"] == "not_connected"

    with factory() as session:
        accounts.connect(session, "github", "ohsuz")
    collect.main(["--collector", "github_stars_api", "--database-url", url, "--dry-run"])
    event = json.loads(capsys.readouterr().out)
    assert event["mode"] == "seed"
    assert event["would_run"][-4:] == ["--account", "ohsuz", "--limit", "100"]


# --- endpoints ---------------------------------------------------------------------------


class _Finished:
    def is_alive(self) -> bool:
        return False


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    factory = library(tmp_path)
    ran: list[str] = []

    def collect_one(surface: str, database_url: str) -> int:
        ran.append(surface)
        with factory() as session:
            _run(session, surface)
        return 0

    def inline(target: Callable[[], None], name: str) -> Any:
        target()
        return _Finished()

    def session_override() -> Iterator[Session]:
        with factory() as session:
            yield session

    monkeypatch.setattr(app_module, "_Session", factory)
    monkeypatch.setattr(app_module, "_collect_surface", collect_one)
    monkeypatch.setattr(background, "_spawn", inline)
    monkeypatch.setattr(background, "_slots", {})
    monkeypatch.setenv("GITHUB_TOKEN", "test-token-value-never-shown")
    app.dependency_overrides[get_session] = session_override
    try:
        with TestClient(app) as test_client:
            test_client.ran = ran  # type: ignore[attr-defined]
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_connecting_collects_at_once(client: TestClient) -> None:
    response = client.put("/api/accounts/huggingface", json={"handle": "huggingface.co/ohsuz"})

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["handle"] == "ohsuz"
    assert body["jobId"]
    assert client.ran == ["huggingface_activity", "huggingface_upvotes"]  # type: ignore[attr-defined]
    hf = next(row for row in body["accounts"] if row["platform"] == "huggingface")
    assert hf["profileUrl"] == "https://huggingface.co/ohsuz"
    assert hf["job"]["state"] == "succeeded"


def test_a_token_is_reported_as_present_and_never_shown(client: TestClient) -> None:
    body = client.get("/api/accounts").json()["data"]

    github = next(row for row in body["accounts"] if row["platform"] == "github")
    assert github["tokenConfigured"] is True
    assert "test-token-value-never-shown" not in json.dumps(body)


def test_a_malformed_name_is_refused_with_the_reason(client: TestClient) -> None:
    response = client.put("/api/accounts/github", json={"handle": "oh suz"})

    assert response.status_code == 422
    assert "계정명 형식이 아니에요" in response.json()["error"]["message"]
    assert client.ran == []  # type: ignore[attr-defined]


def test_collect_now_needs_an_account(client: TestClient) -> None:
    response = client.post("/api/accounts/github/collect")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "account_not_connected"


def test_collect_now_runs_the_platform(client: TestClient) -> None:
    client.put("/api/accounts/github", json={"handle": "ohsuz"})
    client.ran.clear()  # type: ignore[attr-defined]

    response = client.post("/api/accounts/github/collect")

    assert response.status_code == 202
    assert client.ran == ["github_stars_api"]  # type: ignore[attr-defined]
    job = client.get(f"/api/jobs/{response.json()['data']['jobId']}").json()["data"]
    assert job["type"] == "collection"
    assert job["state"] == "succeeded"


def test_disconnect_forgets_the_name(client: TestClient) -> None:
    client.put("/api/accounts/github", json={"handle": "ohsuz"})

    body = client.delete("/api/accounts/github").json()["data"]

    assert next(row for row in body["accounts"] if row["platform"] == "github")["handle"] is None


def test_no_scheduler_runs_unless_asked(client: TestClient) -> None:
    """A test process — or any API not started by dev.sh — must never reach GitHub."""
    import threading

    assert not any(thread.name == "taste-inbox-scheduler" for thread in threading.enumerate())


# --- profile and first-run setup ------------------------------------------------------------


def test_a_fresh_workspace_is_not_onboarded(client: TestClient) -> None:
    assert client.get("/api/profile").json()["data"] == {"name": None, "onboarded": False}


def test_onboarding_stores_everything_and_collects_both(client: TestClient) -> None:
    response = client.post(
        "/api/onboarding",
        json={
            "name": "  Suzie  ",
            "github": "github.com/ohsuz",
            "huggingface": "ohsuz",
            "intervalHours": 6,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()["data"]
    assert body["profile"] == {"name": "Suzie", "onboarded": True}
    assert len(body["jobIds"]) == 2
    assert client.ran == [  # type: ignore[attr-defined]
        "github_stars_api",
        "huggingface_activity",
        "huggingface_upvotes",
    ]
    handles = {row["platform"]: row["handle"] for row in body["accounts"]}
    assert handles == {"github": "ohsuz", "huggingface": "ohsuz"}
    settings = client.get("/api/settings").json()["data"]
    assert settings["collection"]["intervalHours"]["value"] == 6


def test_one_account_is_enough(client: TestClient) -> None:
    response = client.post("/api/onboarding", json={"name": "Suzie", "huggingface": "ohsuz"})

    assert response.status_code == 200
    assert client.ran == ["huggingface_activity", "huggingface_upvotes"]  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"github": "ohsuz"}, "onboarding_name"),
        ({"name": "Suzie"}, "onboarding_accounts"),
        ({"name": "Suzie", "github": "", "huggingface": " "}, "onboarding_accounts"),
        ({"name": "Suzie", "github": "oh suz"}, "onboarding_github"),
        (
            {"name": "Suzie", "github": "ohsuz", "intervalHours": "often"},
            "onboarding_intervalHours",
        ),
        ({"name": "Suzie", "github": "ohsuz", "intervalHours": 0}, "onboarding_intervalHours"),
        ({"name": "x" * 33, "github": "ohsuz"}, "onboarding_name"),
    ],
)
def test_onboarding_refuses_a_field_and_writes_nothing(
    client: TestClient, body: dict[str, Any], code: str
) -> None:
    response = client.post("/api/onboarding", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert client.get("/api/profile").json()["data"]["onboarded"] is False
    accounts_now = client.get("/api/accounts").json()["data"]["accounts"]
    assert all(row["handle"] is None for row in accounts_now)
    assert client.ran == []  # type: ignore[attr-defined]


def test_the_name_can_change_later(client: TestClient) -> None:
    client.post("/api/onboarding", json={"name": "Suzie", "github": "ohsuz"})

    assert client.put("/api/profile", json={"name": "수지"}).json()["data"]["name"] == "수지"
    assert client.put("/api/profile", json={"name": " "}).status_code == 422
