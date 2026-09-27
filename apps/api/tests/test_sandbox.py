"""The sandbox side: reading the boundary, reading a run, and what a trial records.

Nothing here reaches NemoClaw. The boundary is read from recorded `status` output and the
agent's run is replaced at `nemoclaw.run_agent` — the seam the trial runner calls — so what
is tested is this product's reading of the runtime, not the runtime.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from taste_inbox.action import proposal
from taste_inbox.db.models import Evidence, Job, JobStep
from taste_inbox.sandbox import nemoclaw, policy, transcript, trial

from .library import item_id, library, recorded_report, recorded_status

READY_STATUS = recorded_status("status-ready.txt")


def envelope(
    *,
    ok: bool,
    stop: str,
    calls: int,
    failures: int = 0,
    final: str = "done",
) -> str:
    """An `openclaw agent --json` envelope in the shape feasibility F3 recorded.

    Preceded by the runtime's warning line, as it is in real output, so the envelope has
    to be found rather than assumed to start the stream.
    """

    body = {
        "ok": ok,
        "result": {
            "final": final,
            "toolSummary": {"calls": calls, "tools": ["exec", "process"], "failures": failures},
            "completion": {"stopReason": stop},
            "model": "nvidia/nemotron-3-super-120b-a12b",
        },
    }
    return "(node:1) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental\n" + json.dumps(body)


# --- reading the boundary ---------------------------------------------------------------


def test_a_failure_layer_overrides_a_cached_ready_phase() -> None:
    """Docker stopped, gateway still printing `Phase: Ready` — the sandbox is not usable."""

    state = nemoclaw.parse_status("taste-inbox", recorded_status("status-docker-down.txt"))

    assert "Phase: Ready" in recorded_status("status-docker-down.txt")
    assert state["ready"] is False
    assert state["busy"] is False
    assert state["reason"] == "docker_unreachable: Docker daemon is not reachable."
    # The boundary it will have once Docker is back is still stated.
    assert "taste-inbox-trial" in state["policies"]


def test_ready_when_no_layer_is_failing() -> None:
    """Recorded with Docker up. It still carries a retried inference 503 — a warning about
    the model route, not about the boundary, and it must not read as not-ready."""

    state = nemoclaw.parse_status("taste-inbox", READY_STATUS)

    assert "HTTP 503" in READY_STATUS
    assert state["ready"] is True
    assert state["reason"] is None
    assert state["raw"] == ""


def test_a_contended_lock_is_busy_not_missing() -> None:
    state = nemoclaw.parse_status(
        "taste-inbox",
        "Error: Failed to acquire lock on /Users/x/.nemoclaw/state.lock (held by pid 4242)\n",
    )

    assert state["busy"] is True
    assert state["ready"] is False
    assert state["policies"] == []


def test_the_ledger_pairs_hosts_with_the_binaries_allowed_to_reach_them() -> None:
    """F4: `curl` was refused on huggingface.co because that policy lists python3 and node."""

    ledger = {row["policy"]: row for row in nemoclaw.network_policies(READY_STATUS)}

    assert ledger["github"]["hosts"] == ["github.com", "api.github.com"]
    assert ledger["github"]["binaries"] == ["/usr/bin/git"]
    assert "huggingface.co" in ledger["huggingface"]["hosts"]
    assert not any("curl" in binary for binary in ledger["huggingface"]["binaries"])
    # A non-443 port is part of what was allowed, so it is kept.
    assert "10.200.0.2:18789" in ledger["openclaw_gateway_dialback"]["hosts"]


def test_an_unreadable_policy_block_is_an_empty_ledger_not_a_guess() -> None:
    assert nemoclaw.network_policies("Policy:\n  network_policies: [unterminated\n") == []
    assert nemoclaw.network_policies("no policy section at all") == []


def test_policy_check_names_what_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    status = READY_STATUS.replace(", taste-inbox-trial", "")
    monkeypatch.setattr(
        nemoclaw, "status", lambda **_: nemoclaw.parse_status("taste-inbox", status)
    )
    plan = proposal.build(
        subject_id="x",
        subject_title="debpalash/VoiceStudio",
        subject_url="https://github.com/debpalash/VoiceStudio",
        report=recorded_report(),
    ).plan

    check = policy.check(plan)

    assert check.missing_presets == ["taste-inbox-trial"]
    assert check.satisfied is False


def test_policy_check_carries_the_reason_the_sandbox_is_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        nemoclaw,
        "status",
        lambda **_: nemoclaw.parse_status("taste-inbox", recorded_status("status-docker-down.txt")),
    )
    plan = proposal.build(
        subject_id="x", subject_title="t", subject_url="https://github.com/a/b", report="r"
    ).plan

    check = policy.check(plan)

    assert check.satisfied is False
    assert check.reason is not None and check.reason.startswith("docker_unreachable")
    assert check.as_dict()["reason"] == check.reason


# --- reading a run ----------------------------------------------------------------------


def test_transcript_reads_the_envelope_behind_warnings() -> None:
    parsed = transcript.read(envelope(ok=True, stop="stop", calls=24, final="Created hello.py"))

    assert parsed.ok is True
    assert parsed.stop_reason == "stop"
    assert parsed.tool_calls == 24
    assert parsed.tools == ["exec", "process"]
    assert parsed.final_text == "Created hello.py"
    assert parsed.model == "nvidia/nemotron-3-super-120b-a12b"


def test_a_refused_connection_is_recovered_from_either_stream() -> None:
    parsed = transcript.read(
        envelope(ok=True, stop="stop", calls=3),
        # The phrasing F4 recorded, plus the host-bearing form a client prints.
        "curl: (56) CONNECT tunnel failed, response 403\n"
        "fatal: unable to access 'https://voicestudio.sh/install.sh': "
        "CONNECT tunnel failed, response 403\n",
    )

    hosts = [decision.host for decision in parsed.blocked]
    assert "voicestudio.sh" in hosts
    assert None in hosts  # the line with no host is still reported, not dropped


@pytest.mark.parametrize(
    ("exit_code", "ok", "stop", "calls", "expected"),
    [
        (0, True, "stop", 12, "succeeded"),
        # The first Golden Path run: exit 0, the model call timed out after 50 tool calls.
        (0, False, "aborted", 50, "partially_succeeded"),
        (0, False, "aborted", 0, "failed"),
        (0, True, "error", 4, "partially_succeeded"),
        (1, True, "stop", 12, "failed"),
    ],
)
def test_outcome_state_does_not_trust_the_exit_code_alone(
    exit_code: int, ok: bool, stop: str, calls: int, expected: str
) -> None:
    parsed = transcript.read(
        envelope(ok=ok, stop=stop, calls=calls, final="LLM request timed out.")
    )

    state, why = trial.outcome_state(exit_code, parsed)

    assert state == expected
    assert (why is None) == (expected == "succeeded")


def test_a_timed_out_run_says_why() -> None:
    parsed = transcript.read(
        envelope(ok=False, stop="aborted", calls=50, final="LLM request timed out.")
    )

    _, why = trial.outcome_state(0, parsed)

    assert why == "에이전트가 끝내지 못했습니다 (stop=aborted): LLM request timed out."


def test_result_facts_split_the_stored_line() -> None:
    facts = trial.result_facts(
        "exit=0 · tools=50 · failures=1 · stop=aborted · sandbox=taste-inbox"
    )

    assert facts == {
        "exit": "0",
        "tools": "50",
        "failures": "1",
        "stop": "aborted",
        "sandbox": "taste-inbox",
    }


# --- what a trial records ----------------------------------------------------------------


@pytest.fixture
def patched_sandbox(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Replace the three calls a trial makes into the sandbox, and record what they saw."""

    seen: dict[str, Any] = {"stdout": envelope(ok=True, stop="stop", calls=7), "stderr": ""}
    monkeypatch.setattr(
        nemoclaw, "status", lambda **_: nemoclaw.parse_status("taste-inbox", READY_STATUS)
    )

    def run_agent(*, trial_id: str, plan_text: str, sandbox: str, timeout: float) -> Any:
        seen["plan_text"] = plan_text
        return nemoclaw.SandboxRun(
            trial_id=trial_id,
            workdir=f"{nemoclaw.WORK_ROOT}/{trial_id}",
            exit_code=0,
            stdout=seen["stdout"],
            stderr=seen["stderr"],
        )

    monkeypatch.setattr(nemoclaw, "run_agent", run_agent)
    monkeypatch.setattr(
        nemoclaw, "list_workdir", lambda trial_id, **_: ["plan.md", "VoiceStudio", "result.txt"]
    )
    return seen


def _plan(session: Any, url: str) -> proposal.TrialPlan:
    subject = item_id(session, url)
    return proposal.build(
        subject_id=subject,
        subject_title=url.rsplit("/", 2)[-2] + "/" + url.rsplit("/", 1)[-1],
        subject_url=url,
        report=recorded_report(),
    ).plan


def test_a_trial_refuses_without_approval(tmp_path: Path) -> None:
    factory = library(tmp_path)
    with factory() as session:
        plan = _plan(session, "https://github.com/debpalash/VoiceStudio")
        with pytest.raises(PermissionError):
            trial.run(session, plan, approved=False)
        assert session.scalars(select(Job)).all() == []


def test_a_trial_records_result_blocks_and_files(
    tmp_path: Path, patched_sandbox: dict[str, Any]
) -> None:
    patched_sandbox["stderr"] = (
        "curl: (56) CONNECT tunnel failed https://voicestudio.sh/install.sh response 403\n"
    )
    factory = library(tmp_path)
    with factory() as session:
        plan = _plan(session, "https://github.com/debpalash/VoiceStudio")
        outcome = trial.run(session, plan, approved=True)

        assert outcome.state == "succeeded"
        latest = trial.latest(session, plan.subject_id)
        assert latest is not None
        assert latest["facts"]["tools"] == "7"
        assert latest["blocked"] == ["voicestudio.sh"]
        assert latest["artifacts"] == ["plan.md", "VoiceStudio", "result.txt"]

        blocked = session.scalars(
            select(Evidence).where(Evidence.type == trial.BLOCKED_EVIDENCE)
        ).one()
        assert blocked.provenance == "policy"

    # The plan the agent saw is prose, and carries the report's step verbatim.
    assert "docker run -d --name omnivoice" in patched_sandbox["plan_text"]


def test_a_timed_out_agent_is_not_recorded_as_success(
    tmp_path: Path, patched_sandbox: dict[str, Any]
) -> None:
    patched_sandbox["stdout"] = envelope(
        ok=False, stop="aborted", calls=50, failures=1, final="LLM request timed out."
    )
    factory = library(tmp_path)
    with factory() as session:
        plan = _plan(session, "https://github.com/debpalash/VoiceStudio")
        outcome = trial.run(session, plan, approved=True)

        job = session.get(Job, outcome.job_id)
        assert job is not None
        assert job.state == "partially_succeeded"
        agent_step = session.scalar(
            select(JobStep).where(JobStep.job_id == job.id, JobStep.ordinal == 1)
        )
        assert agent_step is not None
        assert agent_step.state == "failed"
        assert agent_step.message is not None and "LLM request timed out." in agent_step.message


def test_a_sandbox_that_is_down_blocks_the_trial(
    tmp_path: Path, patched_sandbox: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        nemoclaw,
        "status",
        lambda **_: nemoclaw.parse_status("taste-inbox", recorded_status("status-docker-down.txt")),
    )
    factory = library(tmp_path)
    with factory() as session:
        plan = _plan(session, "https://github.com/debpalash/VoiceStudio")
        outcome = trial.run(session, plan, approved=True)

        assert outcome.state == "blocked"
        assert "plan_text" not in patched_sandbox  # the agent never ran


def test_a_queued_job_is_continued_not_duplicated(
    tmp_path: Path, patched_sandbox: dict[str, Any]
) -> None:
    factory = library(tmp_path)
    with factory() as session:
        plan = _plan(session, "https://github.com/debpalash/VoiceStudio")
        queued = trial.open_job(session, item_id=plan.subject_id, title="t", state="queued")
        session.commit()
        assert queued.started_at is None

        outcome = trial.run(session, plan, approved=True, job_id=queued.id)

        assert outcome.job_id == queued.id
        assert len(session.scalars(select(Job)).all()) == 1
        assert len(session.scalars(select(JobStep)).all()) == len(trial.STEPS)


def test_docker_cli_is_found_without_a_login_shell(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`~/.zprofile` puts Docker on PATH for login shells only."""

    bin_dir = tmp_path / "docker-bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text("#!/bin/sh\n", "utf-8")
    (bin_dir / "docker").chmod(0o755)
    monkeypatch.setattr(nemoclaw, "_DOCKER_CLI_DIRS", (bin_dir,))
    monkeypatch.setenv("PATH", "/usr/bin:/bin")

    assert nemoclaw._environment()["PATH"].split(":")[-1] == str(bin_dir)


def test_a_docker_already_on_path_is_left_alone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    mine = tmp_path / "mine"
    mine.mkdir()
    (mine / "docker").write_text("#!/bin/sh\n", "utf-8")
    (mine / "docker").chmod(0o755)
    monkeypatch.setenv("PATH", f"{mine}:/usr/bin")

    assert nemoclaw._environment()["PATH"] == f"{mine}:/usr/bin"
