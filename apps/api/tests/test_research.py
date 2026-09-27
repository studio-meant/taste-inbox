"""Context → brief → AI-Q → suggestion, on a recorded AI-Q report.

AI-Q is replaced at `aiq_client.research`, the one call the runner makes to it. The report
it returns is a real one (`data/fixtures/research/`), because the proposal reader exists to
survive AI-Q's actual headings — the first version never matched them and every suggestion
came back non-actionable.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from taste_inbox.action import proposal
from taste_inbox.db.models import Evidence, Job, JobStep
from taste_inbox.research import aiq_client, brief, runner
from taste_inbox.taste import context

from .library import item_id, library, recorded_report

VOICESTUDIO = "https://github.com/debpalash/VoiceStudio"
PAPER = "https://huggingface.co/papers/2501.12948"


# --- TasteContext -------------------------------------------------------------------------


def test_context_connects_an_item_to_what_else_was_saved(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        built = context.build(session, item_id(session, VOICESTUDIO))

    assert built is not None
    neighbours = {row.title: row.shared_terms for row in built.neighbours}
    assert set(neighbours["jamiepine/voicebox"]) >= {"mlx", "cuda", "text-to-speech"}
    assert "mcp" in built.shared_terms
    assert built.is_grounded
    # Six items, all inside the 30-day window of the fixed clock below the fixture dates.
    assert built.recent_kinds == {"repo": 3, "dataset": 1, "space": 1, "paper": 1}


def test_context_is_deterministic(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        first = context.build(session, subject)
        second = context.build(session, subject)

    assert first is not None and second is not None
    assert first.as_dict() == second.as_dict()


def test_a_paper_carries_what_the_hub_stated(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        built = context.build(session, item_id(session, PAPER))

    assert built is not None
    stated = {row["type"]: row["value"] for row in built.stated}
    assert stated["paper.github_repo"] == "deepseek-ai/DeepSeek-R1"


def test_no_context_for_an_unknown_item(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        assert context.build(session, "no-such-item") is None


# --- ResearchBrief ------------------------------------------------------------------------


def test_the_brief_says_what_leaves_the_machine(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        built = context.build(session, item_id(session, VOICESTUDIO))
    assert built is not None

    research_brief = brief.build(built)

    assert research_brief.query.startswith("Subject: debpalash/VoiceStudio (repo, github)")
    assert "citations and source URLs for every claim" in research_brief.query
    # The identifiers it disclosed are the ones in the query, word for word; the rest of
    # the list labels the summaries (topic counts, neighbours) for the screen.
    assert research_brief.disclosed[:2] == [
        "debpalash/VoiceStudio (repo, github)",
        VOICESTUDIO,
    ]
    assert any(line.startswith("recurring topics:") for line in research_brief.disclosed)


@pytest.mark.parametrize(
    "secret",
    [
        "ghp_" + "A" * 36,
        "hf_" + "b" * 34,
        "nvapi-" + "C" * 40,
    ],
)
def test_token_shaped_text_never_reaches_the_brief(tmp_path: Path, secret: str) -> None:
    factory = library(tmp_path)
    with factory() as session:
        built = context.build(session, item_id(session, VOICESTUDIO))
    assert built is not None
    poisoned = replace(built, title=f"debpalash/VoiceStudio {secret}")

    assert secret not in brief.build(poisoned).query


def test_a_paper_without_a_stated_repo_asks_ai_q_to_find_one(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        built = context.build(session, item_id(session, PAPER))
    assert built is not None
    unlinked = replace(
        built, stated=[row for row in built.stated if row["type"] != "paper.github_repo"]
    )

    assert brief.build(built).wants_repo_discovery is False
    assert brief.build(unlinked).wants_repo_discovery is True
    assert brief.REPO_DISCOVERY_QUESTION in brief.build(unlinked).query


# --- the recorded report -> suggestion ------------------------------------------------------


def test_the_recorded_report_is_actionable() -> None:
    suggestion = proposal.build(
        subject_id="x",
        subject_title="debpalash/VoiceStudio",
        subject_url=VOICESTUDIO,
        report=recorded_report(),
    )

    assert suggestion.actionable is True
    assert any(command.startswith("docker run") for command in suggestion.plan.commands_seen)
    assert "github.com" in suggestion.plan.required_hosts
    # Hosts a report names are not a request to open them. These four were refused live.
    assert set(suggestion.plan.refused_hosts) >= {
        "voicestudio.sh",
        "www.remio.ai",
        "tessl.io",
        "hoangyell.com",
    }
    assert not set(suggestion.plan.refused_hosts) & proposal.ALLOWED_TRIAL_HOSTS


def test_a_report_without_a_step_offers_no_trial() -> None:
    suggestion = proposal.build(
        subject_id="x",
        subject_title="t",
        subject_url=VOICESTUDIO,
        report="**Overview**\n\nIt is a desktop app. [1]\n\n- [1] https://github.com/a/b",
    )

    assert suggestion.actionable is False


# --- the runner -----------------------------------------------------------------------------


@pytest.fixture
def recorded_aiq(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    def research(query: str, **kwargs: Any) -> aiq_client.AiqReport:
        seen["query"] = query
        seen.update(kwargs)
        return aiq_client.AiqReport(
            job_id="568c6ddf-f2f6-4b3d-a36a-806d5b2869c0",
            report=recorded_report(),
            raw={},
            server_url=kwargs["server_url"],
        )

    monkeypatch.setattr(aiq_client, "research", research)
    monkeypatch.setenv("AIQ_SERVER_URL", "http://localhost:8010")
    return seen


def test_a_run_stores_the_report_verbatim(tmp_path: Path, recorded_aiq: dict[str, Any]) -> None:
    factory = library(tmp_path)
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        outcome = runner.run(session, subject)

        assert outcome.state == "succeeded"
        assert outcome.suggestion is not None and outcome.suggestion.actionable
        report = session.scalars(
            select(Evidence).where(
                Evidence.item_id == subject, Evidence.type == runner.REPORT_EVIDENCE
            )
        ).one()
        # Citations and source URLs are not trimmed (aiq-research/SKILL.md).
        assert report.value == recorded_report()
        assert report.provenance == "aiq"
        assert report.source_url == (
            "http://localhost:8010/v1/jobs/568c6ddf-f2f6-4b3d-a36a-806d5b2869c0"
        )

        latest = runner.latest(session, subject)
        assert latest is not None
        assert latest["brief"] == recorded_aiq["query"]

        job = session.get(Job, outcome.job_id)
        assert job is not None and job.state == "succeeded"
        states = [
            step.state
            for step in session.scalars(
                select(JobStep).where(JobStep.job_id == job.id).order_by(JobStep.ordinal)
            )
        ]
        assert states == ["done", "done", "done", "done"]


def test_a_second_run_replaces_the_first(tmp_path: Path, recorded_aiq: dict[str, Any]) -> None:
    factory = library(tmp_path)
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        runner.run(session, subject)
        runner.run(session, subject)

        reports = session.scalars(
            select(Evidence).where(
                Evidence.item_id == subject, Evidence.type == runner.REPORT_EVIDENCE
            )
        ).all()
        assert len(reports) == 1


def test_an_unreachable_backend_fails_the_job_and_does_not_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    def research(query: str, **_: Any) -> aiq_client.AiqReport:
        calls.append(query)
        raise aiq_client.AiqUnavailable("connection refused: http://localhost:8010")

    monkeypatch.setattr(aiq_client, "research", research)
    monkeypatch.setenv("AIQ_SERVER_URL", "http://localhost:8010")
    factory = library(tmp_path)
    with factory() as session:
        subject = item_id(session, VOICESTUDIO)
        outcome = runner.run(session, subject)

        assert outcome.state == "failed"
        assert outcome.error == "connection refused: http://localhost:8010"
        assert len(calls) == 1
        assert runner.latest(session, subject) is None
        job = session.get(Job, outcome.job_id)
        assert job is not None and job.state == "failed"


def test_an_empty_report_is_a_failure_not_a_suggestion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        aiq_client,
        "research",
        lambda query, **kwargs: aiq_client.AiqReport(
            job_id="j", report="  ", raw={}, server_url=kwargs["server_url"]
        ),
    )
    monkeypatch.setenv("AIQ_SERVER_URL", "http://localhost:8010")
    factory = library(tmp_path)
    with factory() as session:
        outcome = runner.run(session, item_id(session, VOICESTUDIO))

    assert outcome.state == "failed"
    assert outcome.suggestion is None


@pytest.mark.parametrize(
    ("url", "refused"),
    [
        ("http://localhost:8010", False),
        ("http://127.0.0.1:8010", False),
        ("http://aiq.example.com", True),
        ("ftp://localhost:8010", True),
        ("https://aiq.example.com", False),
    ],
)
def test_a_non_local_backend_must_be_https(url: str, refused: bool) -> None:
    if refused:
        with pytest.raises(aiq_client.AiqUnavailable):
            aiq_client.resolve_server(url)
    else:
        assert aiq_client.resolve_server(url) == url
