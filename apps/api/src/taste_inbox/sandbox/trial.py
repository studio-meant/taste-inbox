"""One trial: approved plan → sandbox → evidence.

A trial only ever starts from a plan the user approved. That is not a UI convention — it
is the condition under which `docs/DECISIONS.md` (2026-09-28) re-allowed running collected
code at all, and this module refuses to run without it.

Three steps, each written before it happens, on the inherited `jobs`/`job_steps` tables:

    check the boundary  →  run the agent  →  record what it did and what was refused

**The refusals are stored as evidence, not as a log.** `provenance="policy"` exists for
this: a card can then draw "the repository tried to reach voicestudio.sh and was stopped"
next to the research that recommended it. Nothing but the sandbox could have observed that.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..action.proposal import TrialPlan
from ..db.models import Evidence, Item, Job, JobStep
from . import nemoclaw, transcript

#: Evidence types a trial writes.
RESULT_EVIDENCE = "trial.result"
TRANSCRIPT_EVIDENCE = "trial.transcript"
BLOCKED_EVIDENCE = "trial.blocked_endpoint"
ARTIFACT_EVIDENCE = "trial.artifact"
ERROR_EVIDENCE = "trial.error_output"

#: How much of a failed run's own output is kept. The tail, because that is where a CLI
#: prints why it stopped.
ERROR_TAIL_CHARS = 4000

_ANSI = re.compile(r"\x1b\[[0-9;]*m")

STEPS = (
    "샌드박스 경계를 확인한다",
    "OpenShell 안에서 에이전트를 실행한다",
    "결과와 차단된 요청을 증거로 남긴다",
)


#: Stop reasons that mean the agent did not finish its turn, whatever the exit code says.
_UNFINISHED_STOPS = frozenset({"aborted", "error", "timeout", "cancelled"})


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def error_tail(stdout: str, stderr: str) -> str:
    """The end of what a failed run printed, colour codes removed.

    Stored because the first failure of the second Golden Path run was an exit code and
    nothing else: the envelope was absent, the transcript empty, and the reason existed only
    in a stream nobody kept.
    """

    combined = "\n".join(part for part in (stderr.strip(), stdout.strip()) if part)
    return _ANSI.sub("", combined)[-ERROR_TAIL_CHARS:]


def outcome_state(exit_code: int, parsed: transcript.TrialTranscript) -> tuple[str, str | None]:
    """The job state one run earned, and why when it is not a success.

    The exit code alone is not enough: `openclaw agent --json` exits 0 when the model call
    times out and reports it only as `ok:false · stopReason:aborted` in the envelope. The
    first Golden Path run was recorded as `succeeded` that way while the agent had written
    nothing but the plan it was given.
    """

    if exit_code != 0:
        return "failed", f"샌드박스 명령이 종료 코드 {exit_code}로 끝났습니다"
    stop = (parsed.stop_reason or "").lower()
    if parsed.ok and stop not in _UNFINISHED_STOPS:
        return "succeeded", None
    reason = parsed.final_text.strip().splitlines()[0][:200] if parsed.final_text.strip() else None
    detail = f"에이전트가 끝내지 못했습니다 (stop={parsed.stop_reason or 'n/a'})"
    if reason:
        detail = f"{detail}: {reason}"
    # Something ran before it stopped: that is a partial result, not nothing.
    if parsed.tool_calls > 0:
        return "partially_succeeded", detail
    return "failed", detail


@dataclass(frozen=True, slots=True)
class TrialOutcome:
    job_id: str
    trial_id: str
    state: str
    sandbox: str
    result: transcript.TrialTranscript | None
    artifacts: list[str]
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "trialId": self.trial_id,
            "state": self.state,
            "sandbox": self.sandbox,
            "artifacts": self.artifacts,
            "error": self.error,
            "result": self.result.as_dict() if self.result else None,
        }


def new_job_id() -> str:
    return f"trial-{uuid.uuid4()}"


def open_job(
    session: Session, *, item_id: str, title: str, job_id: str | None = None, state: str = "running"
) -> Job:
    """Write the job and its steps. `state="queued"` when the run starts later."""

    job = Job(
        id=job_id or new_job_id(),
        type="trial",
        state=state,
        target_id=item_id,
        title=f"안전 실행 · {title}",
        current_step=STEPS[0],
        cancellable=True,
        created_at=_now(),
        started_at=_now() if state == "running" else None,
    )
    session.add(job)
    session.flush()
    for ordinal, label in enumerate(STEPS):
        session.add(
            JobStep(
                id=f"{job.id}-{ordinal}",
                job_id=job.id,
                ordinal=ordinal,
                label=label,
                state="waiting",
            )
        )
    session.flush()
    return job


def _claim(session: Session, job_id: str | None) -> Job | None:
    """A job an endpoint opened as queued, now starting."""

    job = session.get(Job, job_id) if job_id else None
    if job is not None:
        job.state = "running"
        job.started_at = _now()
        session.flush()
    return job


def _step(
    session: Session, job: Job, ordinal: int, state: str, *, message: str | None = None
) -> None:
    row = session.scalar(
        select(JobStep).where(JobStep.job_id == job.id, JobStep.ordinal == ordinal)
    )
    if row is None:
        return
    row.state = state
    if message is not None:
        row.message = message
    if state == "running":
        row.started_at = _now()
        job.current_step = row.label
    else:
        row.finished_at = _now()
    session.flush()


def _finish(session: Session, job: Job, state: str) -> None:
    job.state = state
    job.finished_at = _now()
    job.cancellable = False
    session.flush()


def _clear(session: Session, item_id: str, kinds: tuple[str, ...]) -> None:
    for row in session.scalars(
        select(Evidence).where(Evidence.item_id == item_id, Evidence.type.in_(kinds))
    ).all():
        session.delete(row)
    session.flush()


def run(
    session: Session,
    plan: TrialPlan,
    *,
    approved: bool,
    sandbox: str | None = None,
    timeout: float = nemoclaw.DEFAULT_TIMEOUT_SECONDS,
    job_id: str | None = None,
) -> TrialOutcome:
    """Run one approved plan. Refuses without approval.

    `job_id` continues a job an endpoint already opened as queued, so the endpoint can
    answer with the id at once and let the run continue in the background
    (`api/background.py`).
    """

    if not approved:
        raise PermissionError(
            "a trial runs only on an explicitly approved plan (docs/DECISIONS.md, 2026-09-28)"
        )

    subject = session.get(Item, plan.subject_id)
    if subject is None:
        raise LookupError(f"no item {plan.subject_id!r}")

    trial_id = uuid.uuid4().hex[:12]
    name = nemoclaw.sandbox_name(sandbox)
    job = _claim(session, job_id) or open_job(
        session,
        item_id=plan.subject_id,
        title=subject.title or subject.canonical_url,
        job_id=job_id,
    )
    session.commit()

    try:
        _step(session, job, 0, "running")
        boundary = nemoclaw.status(sandbox=name)
        if not boundary["ready"]:
            _step(session, job, 0, "failed")
            _finish(session, job, "blocked")
            session.commit()
            return TrialOutcome(
                job_id=job.id,
                trial_id=trial_id,
                state="blocked",
                sandbox=name,
                result=None,
                artifacts=[],
                error=f"샌드박스 '{name}' 가 준비되지 않았습니다",
            )
        _step(session, job, 0, "done")
        session.commit()

        _step(session, job, 1, "running")
        # Committed before the agent runs: the run takes minutes, and an open write
        # transaction for that long locks the whole SQLite file against every other writer.
        session.commit()
        window_start = time.time()
        run_result = nemoclaw.run_agent(
            trial_id=trial_id, plan_text=plan.plan_text, sandbox=name, timeout=timeout
        )
        parsed = transcript.read(run_result.stdout, run_result.stderr)
        # The boundary's own record of what it refused during this run. The agent's streams
        # hold at most a proxy 403 or a one-line hint; which program tried which host, and
        # why the policy said no, is only in OpenShell's log.
        refused = nemoclaw.denials(sandbox=name, since=window_start - 1, until=time.time() + 2)
        state, why = outcome_state(run_result.exit_code, parsed)
        _step(session, job, 1, "done" if state == "succeeded" else "failed", message=why)
        session.commit()

        _step(session, job, 2, "running")
        artifacts = nemoclaw.list_workdir(trial_id, sandbox=name)

        _clear(
            session,
            plan.subject_id,
            (
                RESULT_EVIDENCE,
                TRANSCRIPT_EVIDENCE,
                BLOCKED_EVIDENCE,
                ARTIFACT_EVIDENCE,
                ERROR_EVIDENCE,
            ),
        )

        observed = _now()
        session.add(
            Evidence(
                item_id=plan.subject_id,
                type=RESULT_EVIDENCE,
                label="샌드박스 실행 결과",
                value=(
                    f"exit={run_result.exit_code} · tools={parsed.tool_calls}"
                    f" · failures={parsed.tool_failures} · stop={parsed.stop_reason or 'n/a'}"
                    f" · sandbox={name}"
                ),
                provenance="sandbox",
                source_url=subject.canonical_url,
                observed_at=observed,
            )
        )
        if parsed.final_text.strip():
            session.add(
                Evidence(
                    item_id=plan.subject_id,
                    type=TRANSCRIPT_EVIDENCE,
                    label="에이전트가 보고한 것",
                    value=parsed.final_text[:8000],
                    provenance="sandbox",
                    source_url=subject.canonical_url,
                    observed_at=observed,
                )
            )
        if state != "succeeded":
            tail = error_tail(run_result.stdout, run_result.stderr)
            if tail:
                session.add(
                    Evidence(
                        item_id=plan.subject_id,
                        type=ERROR_EVIDENCE,
                        label="샌드박스가 남긴 출력 (끝부분)",
                        value=tail,
                        provenance="sandbox",
                        source_url=None,
                        observed_at=observed,
                    )
                )
        for row in refused:
            session.add(
                Evidence(
                    item_id=plan.subject_id,
                    type=BLOCKED_EVIDENCE,
                    # Korean, because this is the line the user reads on the card.
                    label="정책이 막은 연결 시도",
                    value=denial_value(row),
                    provenance="policy",
                    source_url=None,
                    observed_at=observed,
                )
            )
        logged_hosts = {_bare_host(str(row["host"])) for row in refused}
        for decision in parsed.blocked:
            # Only what the log did not already say, with its program and reason.
            if decision.host is not None and _bare_host(decision.host) in logged_hosts:
                continue
            session.add(
                Evidence(
                    item_id=plan.subject_id,
                    type=BLOCKED_EVIDENCE,
                    label="정책이 막은 연결 시도",
                    value=decision.host or decision.evidence_line,
                    provenance="policy",
                    source_url=None,
                    observed_at=observed,
                )
            )
        for name_of in artifacts[:20]:
            session.add(
                Evidence(
                    item_id=plan.subject_id,
                    type=ARTIFACT_EVIDENCE,
                    label="샌드박스가 남긴 파일",
                    value=name_of,
                    provenance="sandbox",
                    source_url=None,
                    observed_at=observed,
                )
            )
        _step(session, job, 2, "done")
        _finish(session, job, state)
        session.commit()

        return TrialOutcome(
            job_id=job.id,
            trial_id=trial_id,
            state=state,
            sandbox=name,
            result=parsed,
            artifacts=artifacts,
            error=why,
        )

    except nemoclaw.SandboxUnavailable as error:
        session.rollback()
        reopened = session.get(Job, job.id)
        if reopened is not None:
            for ordinal in range(len(STEPS)):
                row = session.scalar(
                    select(JobStep).where(JobStep.job_id == reopened.id, JobStep.ordinal == ordinal)
                )
                if row is not None and row.state in ("running", "waiting"):
                    row.state = "failed" if row.state == "running" else "skipped"
                    row.finished_at = _now()
            _finish(session, reopened, "failed")
            session.commit()
        return TrialOutcome(
            job_id=job.id,
            trial_id=trial_id,
            state="failed",
            sandbox=name,
            result=None,
            artifacts=[],
            error=str(error),
        )


#: Separator inside a stored denial: `host · program · N회 · reason`.
_DENIAL_SEP = " · "


def _bare_host(host: str) -> str:
    return host.removesuffix(":443").lower()


def denial_value(row: dict[str, Any]) -> str:
    """One refused connection as the line stored in `evidence.value`.

    Readable as it stands in the inherited evidence list, and split back apart by
    `denial_parts` for the ledger.
    """

    parts = [_bare_host(str(row["host"])), str(row["binary"]), f"{int(row['count'])}회"]
    if row.get("reason"):
        parts.append(str(row["reason"]))
    return _DENIAL_SEP.join(parts)


def denial_parts(value: str) -> dict[str, Any]:
    """`denial_value` read back. A bare host (from the agent's own streams) keeps only that."""

    parts = value.split(_DENIAL_SEP, 3)
    if len(parts) < 3 or not parts[2].endswith("회"):
        return {"host": value, "binary": None, "count": None, "reason": None}
    count = parts[2].removesuffix("회")
    return {
        "host": parts[0],
        "binary": parts[1],
        "count": int(count) if count.isdigit() else None,
        "reason": parts[3] if len(parts) > 3 else None,
    }


def result_facts(value: str) -> dict[str, str]:
    """The `key=value` pairs of a stored result line, for a screen that draws them apart.

    The line stays the stored form because it is also what a person reads in the evidence
    list; this only splits it back.
    """

    facts: dict[str, str] = {}
    for part in value.split(" · "):
        key, sep, rest = part.partition("=")
        if sep and key.strip():
            facts[key.strip()] = rest.strip()
    return facts


def latest(session: Session, item_id: str) -> dict[str, Any] | None:
    """What the last trial left on this item, for the Focus Canvas."""

    rows = session.scalars(
        select(Evidence)
        .where(Evidence.item_id == item_id)
        .where(
            Evidence.type.in_(
                (
                    RESULT_EVIDENCE,
                    TRANSCRIPT_EVIDENCE,
                    BLOCKED_EVIDENCE,
                    ARTIFACT_EVIDENCE,
                    ERROR_EVIDENCE,
                )
            )
        )
        .order_by(Evidence.id)
    ).all()
    if not rows:
        return None
    result = next((row for row in rows if row.type == RESULT_EVIDENCE), None)
    return {
        "result": result.value if result else None,
        "facts": result_facts(result.value) if result else {},
        "observedAt": result.observed_at if result else None,
        "transcript": next((row.value for row in rows if row.type == TRANSCRIPT_EVIDENCE), None),
        "errorOutput": next((row.value for row in rows if row.type == ERROR_EVIDENCE), None),
        # Hosts alone, for counts and the queue line; `denials` keeps who tried and why.
        "blocked": [
            denial_parts(row.value)["host"] for row in rows if row.type == BLOCKED_EVIDENCE
        ],
        "denials": [denial_parts(row.value) for row in rows if row.type == BLOCKED_EVIDENCE],
        "artifacts": [row.value for row in rows if row.type == ARTIFACT_EVIDENCE],
    }


__all__ = [
    "ARTIFACT_EVIDENCE",
    "BLOCKED_EVIDENCE",
    "ERROR_EVIDENCE",
    "RESULT_EVIDENCE",
    "STEPS",
    "TRANSCRIPT_EVIDENCE",
    "TrialOutcome",
    "denial_parts",
    "denial_value",
    "error_tail",
    "latest",
    "new_job_id",
    "open_job",
    "outcome_state",
    "result_facts",
    "run",
]
