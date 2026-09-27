"""`/api/focus`, `/api/research`, `/api/trials`, `/api/jobs/{id}` — the Focus Canvas contract.

The background runner is made synchronous at its one seam (`background._spawn`), so a
test can post, then read the finished job, without sleeping. What stays real is everything
the endpoint decides before it queues anything: that is where approval, the missing report
and the unready boundary are refused, and a refusal must come back as a refusal rather
than as a queued job that fails later.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from importlib import import_module
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api import background, focus
from taste_inbox.api.app import app, get_session
from taste_inbox.db.models import Job
from taste_inbox.research import aiq_client
from taste_inbox.sandbox import nemoclaw

from .library import item_id, library, recorded_report, recorded_status
from .test_sandbox import READY_STATUS, envelope

VOICESTUDIO = "https://github.com/debpalash/VoiceStudio"

# By path: `taste_inbox.api` re-exports the FastAPI object under the same name.
app_module = import_module("taste_inbox.api.app")


class _Finished:
    """What `_spawn` returns once the work already ran inline."""

    def is_alive(self) -> bool:
        return False


@pytest.fixture
def factory(tmp_path: Path) -> sessionmaker[Session]:
    return library(tmp_path)


@pytest.fixture
def client(factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    def session_override() -> Iterator[Session]:
        with factory() as session:
            yield session

    def inline(target: Callable[[], None], name: str) -> Any:
        target()
        return _Finished()

    monkeypatch.setattr(app_module, "_Session", factory)
    monkeypatch.setattr(background, "_spawn", inline)
    monkeypatch.setattr(background, "_slots", {})
    monkeypatch.setenv("AIQ_SERVER_URL", "http://localhost:8010")
    monkeypatch.setattr(aiq_client, "health", lambda **_: {"status": "healthy"})
    focus.forget_boundary()
    app.dependency_overrides[get_session] = session_override
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
        focus.forget_boundary()


@pytest.fixture
def sandbox(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """A ready sandbox whose agent finishes. Tests change `status`/`stdout` to vary it."""

    state: dict[str, Any] = {
        "status": READY_STATUS,
        "stdout": envelope(ok=True, stop="stop", calls=9),
    }
    monkeypatch.setattr(
        nemoclaw, "status", lambda **_: nemoclaw.parse_status("taste-inbox", state["status"])
    )
    monkeypatch.setattr(
        nemoclaw,
        "run_agent",
        lambda *, trial_id, plan_text, sandbox, timeout: nemoclaw.SandboxRun(
            trial_id=trial_id,
            workdir=f"/sandbox/work/{trial_id}",
            exit_code=0,
            stdout=state["stdout"],
            stderr="",
        ),
    )
    monkeypatch.setattr(nemoclaw, "list_workdir", lambda trial_id, **_: ["plan.md"])
    return state


@pytest.fixture
def recorded_aiq(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        aiq_client,
        "research",
        lambda query, **kwargs: aiq_client.AiqReport(
            job_id="568c6ddf", report=recorded_report(), raw={}, server_url=kwargs["server_url"]
        ),
    )


def _voicestudio(factory: sessionmaker[Session]) -> str:
    with factory() as session:
        return item_id(session, VOICESTUDIO)


# --- /api/focus --------------------------------------------------------------------------


def test_focus_before_any_research(
    client: TestClient, factory: sessionmaker[Session], sandbox: dict[str, Any]
) -> None:
    body = client.get(f"/api/focus/{_voicestudio(factory)}").json()["data"]

    assert body["item"]["title"] == "debpalash/VoiceStudio"
    assert body["item"]["actionAt"] == "2026-09-26T09:00:00Z"
    assert body["context"]["grounded"] is True
    # Absent, not invented.
    assert body["research"] is None
    assert body["suggestion"] is None
    assert body["trial"] is None
    assert body["jobs"] == {"research": None, "trial": None}
    assert body["boundary"]["ready"] is True
    assert body["boundary"]["missingPresets"] == []
    assert any(row["policy"] == "github" for row in body["boundary"]["endpoints"])


def test_focus_says_why_the_boundary_is_down(
    client: TestClient, factory: sessionmaker[Session], sandbox: dict[str, Any]
) -> None:
    sandbox["status"] = recorded_status("status-docker-down.txt")

    boundary = client.get(f"/api/focus/{_voicestudio(factory)}").json()["data"]["boundary"]

    assert boundary["ready"] is False
    assert boundary["reason"].startswith("docker_unreachable")


def test_focus_of_a_paper_draws_its_bundle(
    client: TestClient, factory: sessionmaker[Session], sandbox: dict[str, Any]
) -> None:
    with factory() as session:
        paper = item_id(session, "https://huggingface.co/papers/2501.12948")

    bundle = client.get(f"/api/focus/{paper}").json()["data"]["bundle"]

    assert bundle["repoProvenance"] == "author-linked"
    assert bundle["repo"]["value"] == "deepseek-ai/DeepSeek-R1"
    assert bundle["totals"] == {"models": 521, "spaces": 4297}
    assert bundle["spaces"] == []


def test_focus_of_an_unknown_item_is_404(client: TestClient, sandbox: dict[str, Any]) -> None:
    response = client.get("/api/focus/no-such-item")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "item_not_found"


# --- /api/research -----------------------------------------------------------------------


def test_research_answers_with_a_job_and_the_job_finishes(
    client: TestClient,
    factory: sessionmaker[Session],
    sandbox: dict[str, Any],
    recorded_aiq: None,
) -> None:
    subject = _voicestudio(factory)

    response = client.post("/api/research", json={"itemId": subject})

    assert response.status_code == 202
    started = response.json()["data"]
    assert started["state"] == "queued"
    assert started["serverUrl"] == "http://localhost:8010"

    job = client.get(f"/api/jobs/{started['jobId']}").json()["data"]
    assert job["type"] == "research"
    assert job["state"] == "succeeded"
    assert [step["state"] for step in job["steps"]] == ["done"] * 4

    body = client.get(f"/api/focus/{subject}").json()["data"]
    assert body["research"]["report"] == recorded_report()
    assert body["suggestion"]["actionable"] is True
    assert body["jobs"]["research"]["id"] == started["jobId"]


def test_research_refuses_a_non_local_http_backend(
    client: TestClient, factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AIQ_SERVER_URL", "http://aiq.example.com")

    response = client.post("/api/research", json={"itemId": _voicestudio(factory)})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "aiq_unavailable"
    with factory() as session:
        assert session.scalars(select(Job)).all() == []  # nothing was queued


def test_research_needs_an_explicit_backend(
    client: TestClient, factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("AIQ_SERVER_URL")

    response = client.post("/api/research", json={"itemId": _voicestudio(factory)})

    assert response.status_code == 503
    assert "AIQ_SERVER_URL" in response.json()["error"]["message"]


def test_research_is_not_sent_to_something_that_is_not_ai_q(
    client: TestClient, factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Something else answering on the port — a dashboard, another project's API."""

    def not_aiq(**_: Any) -> dict[str, Any]:
        raise aiq_client.AiqUnavailable("aiq-research failed: HTTP 404")

    sent: list[str] = []
    monkeypatch.setattr(aiq_client, "health", not_aiq)
    monkeypatch.setattr(aiq_client, "research", lambda query, **_: sent.append(query))

    response = client.post("/api/research", json={"itemId": _voicestudio(factory)})

    assert response.status_code == 503
    assert "AI-Q가 응답하지 않습니다" in response.json()["error"]["message"]
    assert sent == []
    with factory() as session:
        assert session.scalars(select(Job)).all() == []


def test_research_while_another_runs_is_refused(
    client: TestClient, factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(background, "busy", lambda kind: kind == "research")

    response = client.post("/api/research", json={"itemId": _voicestudio(factory)})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "research_busy"


def test_a_research_run_that_crashes_still_lands_as_failed(
    client: TestClient, factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(query: str, **_: Any) -> aiq_client.AiqReport:
        raise ValueError("unexpected envelope")

    monkeypatch.setattr(aiq_client, "research", explode)

    started = client.post("/api/research", json={"itemId": _voicestudio(factory)}).json()["data"]
    job = client.get(f"/api/jobs/{started['jobId']}").json()["data"]

    assert job["state"] == "failed"
    failed = [step for step in job["steps"] if step["state"] == "failed"]
    assert failed and failed[0]["message"] == "ValueError: unexpected envelope"


# --- /api/trials -------------------------------------------------------------------------


def test_a_trial_needs_explicit_approval(
    client: TestClient, factory: sessionmaker[Session], sandbox: dict[str, Any]
) -> None:
    subject = _voicestudio(factory)

    for body in ({"itemId": subject}, {"itemId": subject, "approved": "yes"}):
        response = client.post("/api/trials", json=body)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "approval_required"


def test_a_trial_needs_research_first(
    client: TestClient, factory: sessionmaker[Session], sandbox: dict[str, Any]
) -> None:
    response = client.post("/api/trials", json={"itemId": _voicestudio(factory), "approved": True})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "research_required"


def test_a_trial_on_a_down_sandbox_is_refused_with_the_reason(
    client: TestClient,
    factory: sessionmaker[Session],
    sandbox: dict[str, Any],
    recorded_aiq: None,
) -> None:
    subject = _voicestudio(factory)
    client.post("/api/research", json={"itemId": subject})
    sandbox["status"] = recorded_status("status-docker-down.txt")

    response = client.post("/api/trials", json={"itemId": subject, "approved": True})

    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "boundary_not_ready"
    assert "docker_unreachable" in error["message"]
    with factory() as session:
        assert session.scalars(select(Job).where(Job.type == "trial")).all() == []


def test_an_approved_trial_runs_and_lands_on_the_canvas(
    client: TestClient,
    factory: sessionmaker[Session],
    sandbox: dict[str, Any],
    recorded_aiq: None,
) -> None:
    subject = _voicestudio(factory)
    client.post("/api/research", json={"itemId": subject})

    response = client.post("/api/trials", json={"itemId": subject, "approved": True})

    assert response.status_code == 202
    started = response.json()["data"]
    assert started["policy"]["satisfied"] is True
    assert "voicestudio.sh" in started["policy"]["refusedHosts"]

    job = client.get(f"/api/jobs/{started['jobId']}").json()["data"]
    assert job["type"] == "trial"
    assert job["state"] == "succeeded"

    body = client.get(f"/api/focus/{subject}").json()["data"]
    assert body["trial"]["facts"]["tools"] == "9"
    assert body["trial"]["artifacts"] == ["plan.md"]
    assert body["jobs"]["trial"]["state"] == "succeeded"


def test_an_unknown_job_is_404(client: TestClient) -> None:
    response = client.get("/api/jobs/trial-nope")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "job_not_found"


# --- orphans -----------------------------------------------------------------------------


def test_jobs_left_running_by_a_dead_process_are_closed(
    factory: sessionmaker[Session],
) -> None:
    from taste_inbox.sandbox import trial

    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        job = trial.open_job(session, item_id=subject, title="t", state="running")
        session.commit()
        job_id = job.id

        assert background.close_orphans(session) == 1

        closed = session.get(Job, job_id)
        assert closed is not None and closed.state == "failed"
        assert background.close_orphans(session) == 0
