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

STEPS = (
    "샌드박스 경계를 확인한다",
    "OpenShell 안에서 에이전트를 실행한다",
    "결과와 차단된 요청을 증거로 남긴다",
)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


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


def _open_job(session: Session, *, item_id: str, title: str) -> Job:
    job = Job(
        id=f"trial-{uuid.uuid4()}",
        type="trial",
        state="running",
        target_id=item_id,
        title=f"안전 실행 · {title}",
        current_step=STEPS[0],
        cancellable=1,
        created_at=_now(),
        started_at=_now(),
    )
    session.add(job)
    session.flush()
    for ordinal, label in enumerate(STEPS):
        session.add(
            JobStep(id=f"{job.id}-{ordinal}", job_id=job.id, ordinal=ordinal, label=label, state="waiting")
        )
    session.flush()
    return job


def _step(session: Session, job: Job, ordinal: int, state: str) -> None:
    row = session.scalar(select(JobStep).where(JobStep.job_id == job.id, JobStep.ordinal == ordinal))
    if row is None:
        return
    row.state = state
    if state == "running":
        row.started_at = _now()
        job.current_step = row.label
    else:
        row.finished_at = _now()
    session.flush()


def _finish(session: Session, job: Job, state: str) -> None:
    job.state = state
    job.finished_at = _now()
    job.cancellable = 0
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
) -> TrialOutcome:
    """Run one approved plan. Refuses without approval."""

    if not approved:
        raise PermissionError(
            "a trial runs only on an explicitly approved plan (docs/DECISIONS.md, 2026-09-28)"
        )

    subject = session.get(Item, plan.subject_id)
    if subject is None:
        raise LookupError(f"no item {plan.subject_id!r}")

    trial_id = uuid.uuid4().hex[:12]
    name = nemoclaw.sandbox_name(sandbox)
    job = _open_job(session, item_id=plan.subject_id, title=subject.title or subject.canonical_url)
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
        run_result = nemoclaw.run_agent(
            trial_id=trial_id, plan_text=plan.plan_text, sandbox=name, timeout=timeout
        )
        parsed = transcript.read(run_result.stdout, run_result.stderr)
        _step(session, job, 1, "done" if run_result.ok else "failed")
        session.commit()

        _step(session, job, 2, "running")
        artifacts = nemoclaw.list_workdir(trial_id, sandbox=name)

        _clear(
            session,
            plan.subject_id,
            (RESULT_EVIDENCE, TRANSCRIPT_EVIDENCE, BLOCKED_EVIDENCE, ARTIFACT_EVIDENCE),
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
        for decision in parsed.blocked:
            session.add(
                Evidence(
                    item_id=plan.subject_id,
                    type=BLOCKED_EVIDENCE,
                    # Korean, because this is the line the user reads on the card.
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
        _finish(session, job, "succeeded" if run_result.ok else "partially_succeeded")
        session.commit()

        return TrialOutcome(
            job_id=job.id,
            trial_id=trial_id,
            state="succeeded" if run_result.ok else "partially_succeeded",
            sandbox=name,
            result=parsed,
            artifacts=artifacts,
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


def latest(session: Session, item_id: str) -> dict[str, Any] | None:
    """What the last trial left on this item, for the Focus Canvas."""

    rows = session.scalars(
        select(Evidence)
        .where(Evidence.item_id == item_id)
        .where(
            Evidence.type.in_(
                (RESULT_EVIDENCE, TRANSCRIPT_EVIDENCE, BLOCKED_EVIDENCE, ARTIFACT_EVIDENCE)
            )
        )
        .order_by(Evidence.id)
    ).all()
    if not rows:
        return None
    result = next((row for row in rows if row.type == RESULT_EVIDENCE), None)
    return {
        "result": result.value if result else None,
        "observedAt": result.observed_at if result else None,
        "transcript": next(
            (row.value for row in rows if row.type == TRANSCRIPT_EVIDENCE), None
        ),
        "blocked": [row.value for row in rows if row.type == BLOCKED_EVIDENCE],
        "artifacts": [row.value for row in rows if row.type == ARTIFACT_EVIDENCE],
    }


__all__ = [
    "ARTIFACT_EVIDENCE",
    "BLOCKED_EVIDENCE",
    "RESULT_EVIDENCE",
    "STEPS",
    "TRANSCRIPT_EVIDENCE",
    "TrialOutcome",
    "latest",
    "run",
]
