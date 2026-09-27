"""The Focus and Today payloads, pinned as goldens both languages read.

`packages/shared/tests/focus-contract.test.ts` parses every file this writes with the zod
schema the web app validates against. So a field renamed here fails there, and a schema
tightened there fails against what this service actually emits — the same arrangement
`resource-policy/expected/` has used since the start, applied to the new screens.

Ids and wall-clock stamps are replaced before comparing, because they are the only parts
of the payload that differ between two correct runs. Regenerate after an intentional
change with `TASTE_INBOX_UPDATE_GOLDENS=1 uv run pytest tests/test_focus_contract.py`.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api import focus
from taste_inbox.api.app import app, get_session
from taste_inbox.research import aiq_client
from taste_inbox.research import runner as research_runner
from taste_inbox.sandbox import nemoclaw
from taste_inbox.sandbox import trial as trial_runner

from .library import FIXTURES, item_id, library, recorded_report, recorded_status
from .test_sandbox import READY_STATUS, envelope

GOLDENS = FIXTURES / "focus"
UPDATE = os.environ.get("TASTE_INBOX_UPDATE_GOLDENS") == "1"

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
_TRIAL_DIR = re.compile(r"(?<=trial-)[0-9a-f]{12}\b")

#: Stamps that come from the fixture library rather than the clock. Kept, so the golden
#: still shows that an action time is the platform's and not ours.
_FIXED_STAMP_KEYS = {"actionAt"}


def _normalise(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {name: _normalise(inner, name) for name, inner in value.items()}
    if isinstance(value, list):
        return [_normalise(inner, key) for inner in value]
    if isinstance(value, str):
        if _STAMP.match(value) and key not in _FIXED_STAMP_KEYS:
            return "2026-09-28T00:00:00Z"
        replaced = _UUID.sub("00000000-0000-0000-0000-000000000000", value)
        return _TRIAL_DIR.sub("000000000000", replaced)
    return value


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    factory = library(tmp_path)
    monkeypatch.setenv("AIQ_SERVER_URL", "http://localhost:8010")
    status = {"text": READY_STATUS}
    monkeypatch.setattr(
        nemoclaw, "status", lambda **_: nemoclaw.parse_status("taste-inbox", status["text"])
    )
    monkeypatch.setattr(
        aiq_client,
        "research",
        lambda query, **kwargs: aiq_client.AiqReport(
            job_id="568c6ddf-f2f6-4b3d-a36a-806d5b2869c0",
            report=recorded_report(),
            raw={},
            server_url=kwargs["server_url"],
        ),
    )
    monkeypatch.setattr(
        nemoclaw,
        "run_agent",
        lambda *, trial_id, plan_text, sandbox, timeout: nemoclaw.SandboxRun(
            trial_id=trial_id,
            workdir=f"/sandbox/work/{trial_id}",
            exit_code=0,
            stdout=envelope(
                ok=False, stop="aborted", calls=50, failures=1, final="LLM request timed out."
            ),
            stderr="curl: (56) CONNECT tunnel failed https://voicestudio.sh/install.sh "
            "response 403\n",
        ),
    )
    monkeypatch.setattr(nemoclaw, "list_workdir", lambda trial_id, **_: ["plan.md"])
    # The recorded stretch of the second Golden Path run's sandbox log.
    monkeypatch.setattr(
        nemoclaw,
        "denials",
        lambda **_: nemoclaw.parse_denials(recorded_status("logs-trial-uv-denied.txt")),
    )

    def session_override() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_session] = session_override
    focus.forget_boundary()
    try:
        with TestClient(app) as test_client:
            test_client.factory = factory  # type: ignore[attr-defined]
            test_client.status = status  # type: ignore[attr-defined]
            yield test_client
    finally:
        app.dependency_overrides.clear()
        focus.forget_boundary()


def _check(name: str, payload: Any) -> None:
    path = GOLDENS / f"{name}.json"
    normalised = _normalise(payload)
    if UPDATE:
        GOLDENS.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(normalised, ensure_ascii=False, indent=2) + "\n", "utf-8")
    assert path.exists(), f"missing golden {path.name}; regenerate (see module docstring)"
    assert normalised == json.loads(path.read_text("utf-8"))


def _queue_part(today: dict[str, Any]) -> dict[str, Any]:
    """The part of Today this change owns. Greeting and date follow the wall clock."""

    return {"counts": today["counts"], "workingQueue": today["workingQueue"]}


def test_goldens(client: TestClient) -> None:
    factory: sessionmaker[Session] = client.factory  # type: ignore[attr-defined]
    with factory() as session:
        repo = item_id(session, "https://github.com/debpalash/VoiceStudio")
        paper = item_id(session, "https://huggingface.co/papers/2501.12948")

    _check("repo-unresearched", client.get(f"/api/focus/{repo}").json()["data"])
    _check("paper-bundle", client.get(f"/api/focus/{paper}").json()["data"])

    with factory() as session:
        outcome = research_runner.run(session, repo)
    _check("repo-awaiting-approval", client.get(f"/api/focus/{repo}").json()["data"])
    _check("today-awaiting-approval", _queue_part(client.get("/api/today").json()["data"]))

    assert outcome.suggestion is not None
    with factory() as session:
        trial_runner.run(session, outcome.suggestion.plan, approved=True)
    _check("repo-trial-timed-out", client.get(f"/api/focus/{repo}").json()["data"])
    _check("today-trial-blocked", _queue_part(client.get("/api/today").json()["data"]))

    client.status["text"] = recorded_status("status-docker-down.txt")  # type: ignore[attr-defined]
    focus.forget_boundary()
    _check("repo-sandbox-down", client.get(f"/api/focus/{repo}").json()["data"])
