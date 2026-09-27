"""One research run: context → brief → AI-Q → evidence → suggestion.

The job rows are the inherited `jobs`/`job_steps` tables, unchanged. A research run is
four steps and each one is written before it happens, so a run that dies mid-way leaves a
record saying where it stopped rather than vanishing.

**The report is stored verbatim**, citations and URLs intact, as evidence with
`provenance="aiq"`. `aiq-research/SKILL.md` requires it and this product needs it for the
same reason: a suggestion with no traceable source is the thing `DESIGN.md` §3.5 exists to
prevent.

**Nothing retries.** A failed AI-Q job is recorded as failed and surfaced. The skill says
not to retry automatically, and a research loop that re-asked on its own would spend real
money on a question the user might not want asked again.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..action import proposal
from ..action.proposal import SuggestedAction
from ..db.models import Evidence, Job, JobStep
from ..taste import context as taste_context
from . import aiq_client, brief

#: Evidence types this runner writes. Prefixed so a reader can find everything one
#: research run produced without knowing which job id it belonged to.
REPORT_EVIDENCE = "research.report"
BRIEF_EVIDENCE = "research.brief"
SUGGESTION_EVIDENCE = "research.suggestion"

STEPS = (
    ("context", "저장 이력에서 관심 맥락을 만든다"),
    ("brief", "조사 질문을 구성한다"),
    ("research", "NVIDIA AI-Q에 조사를 맡긴다"),
    ("propose", "행동 제안과 실행 계획을 만든다"),
)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True, slots=True)
class ResearchOutcome:
    job_id: str
    state: str
    suggestion: SuggestedAction | None
    server_url: str | None
    #: Present when the run failed, in the backend's own words.
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "state": self.state,
            "serverUrl": self.server_url,
            "error": self.error,
            "suggestion": self.suggestion.as_dict() if self.suggestion else None,
        }


def new_job_id() -> str:
    return f"research-{uuid.uuid4()}"


def open_job(
    session: Session, *, item_id: str, title: str, job_id: str | None = None, state: str = "running"
) -> Job:
    """Write the job and its steps. `state="queued"` when the run starts later."""

    job = Job(
        id=job_id or new_job_id(),
        type="research",
        state=state,
        target_id=item_id,
        title=f"조사 · {title}",
        current_step=STEPS[0][1],
        cancellable=True,
        created_at=_now(),
        started_at=_now() if state == "running" else None,
    )
    session.add(job)
    session.flush()
    for ordinal, (_, label) in enumerate(STEPS):
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


def _step(session: Session, job: Job, ordinal: int, state: str) -> None:
    row = session.scalar(
        select(JobStep).where(JobStep.job_id == job.id, JobStep.ordinal == ordinal)
    )
    if row is None:
        return
    row.state = state
    if state == "running":
        row.started_at = _now()
        job.current_step = row.label
    elif state in ("done", "failed", "skipped"):
        row.finished_at = _now()
    session.flush()


def _finish(session: Session, job: Job, state: str) -> None:
    job.state = state
    job.finished_at = _now()
    job.cancellable = False
    session.flush()


def _replace_evidence(
    session: Session, *, item_id: str, kind: str, label: str, value: str, source_url: str | None
) -> None:
    """One row per kind per item — the newest research answers, the older one goes.

    Replacing rather than accumulating because the card shows *the* research, and three
    superseded reports stacked under one item is a worse answer than the current one.
    """

    for row in session.scalars(
        select(Evidence).where(Evidence.item_id == item_id, Evidence.type == kind)
    ).all():
        session.delete(row)
    session.flush()
    session.add(
        Evidence(
            item_id=item_id,
            type=kind,
            label=label,
            value=value,
            provenance="aiq",
            source_url=source_url,
            observed_at=_now(),
        )
    )
    session.flush()


def run(
    session: Session,
    item_id: str,
    *,
    agent_type: str = "shallow_researcher",
    server_url: str | None = None,
    timeout: float = aiq_client.DEFAULT_TIMEOUT_SECONDS,
    job_id: str | None = None,
) -> ResearchOutcome:
    """Research one item end to end, recording every step as it happens.

    `job_id` continues a job an endpoint already opened as queued (`api/background.py`).
    """

    subject = taste_context.build(session, item_id)
    if subject is None:
        raise LookupError(f"no item {item_id!r}")

    job = _claim(session, job_id) or open_job(
        session, item_id=item_id, title=subject.title, job_id=job_id
    )
    session.commit()

    try:
        _step(session, job, 0, "running")
        _step(session, job, 0, "done")

        _step(session, job, 1, "running")
        research_brief = brief.build(subject)
        _replace_evidence(
            session,
            item_id=item_id,
            kind=BRIEF_EVIDENCE,
            label="이 기계를 떠난 조사 질문",
            value=research_brief.query,
            source_url=None,
        )
        _step(session, job, 1, "done")
        session.commit()

        _step(session, job, 2, "running")
        # Committed before the call: AI-Q takes minutes, and holding a write transaction
        # that long locks the SQLite file against every other writer.
        session.commit()
        resolved = aiq_client.resolve_server(server_url)
        report = aiq_client.research(
            research_brief.query,
            agent_type=agent_type,
            server_url=resolved,
            timeout=timeout,
        )
        if not report.has_report:
            _step(session, job, 2, "failed")
            _finish(session, job, "failed")
            session.commit()
            return ResearchOutcome(
                job_id=job.id,
                state="failed",
                suggestion=None,
                server_url=resolved,
                error="AI-Q가 리포트 없이 끝났습니다",
            )

        _replace_evidence(
            session,
            item_id=item_id,
            kind=REPORT_EVIDENCE,
            label="NVIDIA AI-Q 조사 결과",
            # Verbatim. Citations and source URLs are not trimmed (SKILL.md).
            value=report.report,
            source_url=(report.job_id and f"{resolved}/v1/jobs/{report.job_id}") or resolved,
        )
        _step(session, job, 2, "done")
        session.commit()

        _step(session, job, 3, "running")
        suggestion = proposal.build(
            subject_id=item_id,
            subject_title=subject.title,
            subject_url=subject.canonical_url,
            report=report.report,
        )
        _replace_evidence(
            session,
            item_id=item_id,
            kind=SUGGESTION_EVIDENCE,
            label="제안된 다음 걸음",
            value=suggestion.headline,
            source_url=subject.canonical_url,
        )
        _step(session, job, 3, "done")
        _finish(session, job, "succeeded")
        session.commit()

        return ResearchOutcome(
            job_id=job.id, state="succeeded", suggestion=suggestion, server_url=resolved
        )

    except aiq_client.AiqUnavailable as error:
        session.rollback()
        # Re-read: the rollback discarded the in-memory job, and the failure has to land.
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
        return ResearchOutcome(
            job_id=job.id,
            state="failed",
            suggestion=None,
            server_url=None,
            error=str(error),
        )


def latest(session: Session, item_id: str) -> dict[str, Any] | None:
    """What the last research run left on this item, for the Focus Canvas."""

    rows = {
        row.type: row
        for row in session.scalars(
            select(Evidence)
            .where(Evidence.item_id == item_id)
            .where(Evidence.type.in_([REPORT_EVIDENCE, BRIEF_EVIDENCE, SUGGESTION_EVIDENCE]))
        ).all()
    }
    report = rows.get(REPORT_EVIDENCE)
    if report is None:
        return None
    return {
        "report": report.value,
        "observedAt": report.observed_at,
        "sourceUrl": report.source_url,
        "brief": rows[BRIEF_EVIDENCE].value if BRIEF_EVIDENCE in rows else None,
        "headline": rows[SUGGESTION_EVIDENCE].value if SUGGESTION_EVIDENCE in rows else None,
    }


__all__ = [
    "BRIEF_EVIDENCE",
    "REPORT_EVIDENCE",
    "STEPS",
    "SUGGESTION_EVIDENCE",
    "ResearchOutcome",
    "latest",
    "new_job_id",
    "open_job",
    "run",
]
