"""The Working Queue, built from research and trial jobs (PAGE_SPECIFICATIONS.md §5.2)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.orm import Session, sessionmaker

from taste_inbox.api.today import QUEUE_LIMIT, build_today
from taste_inbox.research import aiq_client
from taste_inbox.research import runner as research_runner
from taste_inbox.sandbox import nemoclaw
from taste_inbox.sandbox import trial as trial_runner

from .library import item_id, library, recorded_report
from .test_sandbox import READY_STATUS, envelope

VOICESTUDIO = "https://github.com/debpalash/VoiceStudio"
VOICEBOX = "https://github.com/jamiepine/voicebox"


@pytest.fixture
def factory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> sessionmaker[Session]:
    monkeypatch.setenv("AIQ_SERVER_URL", "http://localhost:8010")
    monkeypatch.setattr(
        nemoclaw, "status", lambda **_: nemoclaw.parse_status("taste-inbox", READY_STATUS)
    )
    monkeypatch.setattr(nemoclaw, "list_workdir", lambda trial_id, **_: [])
    monkeypatch.setattr(nemoclaw, "denials", lambda **_: [])
    return library(tmp_path)


def _report(monkeypatch: pytest.MonkeyPatch, text: str) -> None:
    monkeypatch.setattr(
        aiq_client,
        "research",
        lambda query, **kwargs: aiq_client.AiqReport(
            job_id="j", report=text, raw={}, server_url=kwargs["server_url"]
        ),
    )


def _agent(monkeypatch: pytest.MonkeyPatch, stdout: str) -> None:
    monkeypatch.setattr(
        nemoclaw,
        "run_agent",
        lambda *, trial_id, plan_text, sandbox, timeout: nemoclaw.SandboxRun(
            trial_id=trial_id, workdir="/sandbox/work/x", exit_code=0, stdout=stdout, stderr=""
        ),
    )


def _queue(session: Session) -> list[dict[str, Any]]:
    return list(build_today(session)["workingQueue"])


def test_no_jobs_means_an_empty_queue(factory: sessionmaker[Session]) -> None:
    with factory() as session:
        today = build_today(session)

    assert today["workingQueue"] == []
    assert today["counts"]["readyActions"] == 0


def test_research_with_a_plan_waits_for_approval(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _report(monkeypatch, recorded_report())
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        research_runner.run(session, subject)
        today = build_today(session)

    row = today["workingQueue"][0]
    assert row["kind"] == "approval_required"
    assert row["target"] == "debpalash/VoiceStudio"
    assert row["href"] == f"/focus/{subject}"
    assert today["counts"]["readyActions"] == 1


def test_research_without_a_step_is_ready_to_read(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _report(monkeypatch, "**Overview**\n\nA desktop app. [1]")
    with factory() as session:
        research_runner.run(session, item_id(session, VOICESTUDIO))
        today = build_today(session)

    assert today["workingQueue"][0]["kind"] == "research_ready"
    assert today["counts"]["readyActions"] == 0


def test_a_running_trial_shows_its_steps(factory: sessionmaker[Session]) -> None:
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        job = trial_runner.open_job(session, item_id=subject, title="t", state="running")
        job.current_step = trial_runner.STEPS[1]
        session.commit()
        row = _queue(session)[0]

    assert row["kind"] == "trial_running"
    assert row["nextStep"] == trial_runner.STEPS[1]
    assert row["progress"] == 0.0


def test_a_finished_trial_replaces_the_approval_it_came_from(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _report(monkeypatch, recorded_report())
    _agent(monkeypatch, envelope(ok=True, stop="stop", calls=5))
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        outcome = research_runner.run(session, subject)
        assert outcome.suggestion is not None
        trial_runner.run(session, outcome.suggestion.plan, approved=True)
        today = build_today(session)

    assert [row["kind"] for row in today["workingQueue"]] == ["trial_ready"]
    assert today["counts"]["readyActions"] == 0


def test_a_timed_out_trial_needs_attention_and_says_why(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _report(monkeypatch, recorded_report())
    _agent(
        monkeypatch,
        envelope(ok=False, stop="aborted", calls=50, final="LLM request timed out."),
    )
    with factory() as session:
        before = build_today(session)["counts"]["attention"]
        outcome = research_runner.run(session, item_id(session, VOICESTUDIO))
        assert outcome.suggestion is not None
        trial_runner.run(session, outcome.suggestion.plan, approved=True)
        today = build_today(session)

    row = today["workingQueue"][0]
    assert row["kind"] == "trial_blocked"
    assert "LLM request timed out." in row["nextStep"]
    assert today["counts"]["attention"] == before + 1


def test_moving_rows_come_first(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _report(monkeypatch, recorded_report())
    with factory() as session:
        research_runner.run(session, item_id(session, VOICESTUDIO))
        running = research_runner.open_job(
            session, item_id=item_id(session, VOICEBOX), title="t", state="running"
        )
        session.commit()
        kinds = [row["kind"] for row in _queue(session)]
        assert running.id

    assert kinds == ["research_running", "approval_required"]


def test_the_queue_is_capped(factory: sessionmaker[Session]) -> None:
    from sqlalchemy import select

    from taste_inbox.db.models import Item

    with factory() as session:
        for subject in session.scalars(select(Item.id)).all():
            research_runner.open_job(session, item_id=subject, title="t", state="running")
        session.commit()
        assert len(_queue(session)) == min(QUEUE_LIMIT, 7)
