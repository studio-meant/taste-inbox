"""The user's question, turned into a plan by the same backend that did the research.

`The agent turns your question into a trial.` This module is that sentence's implementation
and it is a second AI-Q pass, not a template. The reason is the one `CLAUDE.md` §5 gives for
AI-Q being load-bearing at all: how you verify "이 모델은 어떤 입력에 약한가요?" for *this*
repository is not derivable from the question. It depends on what the repository ships, what
the first report found, and what the sandbox can do — and a template that pretended otherwise
would produce an acceptance criterion nobody could meet and a plan the agent would ignore.

    user question + subject + the first report  →  AI-Q  →  three headings
                                                            1. Verification goal
                                                            2. Acceptance criteria
                                                            3. Trial plan

**The three headings are asked for by name**, and parsed by name (`action/proposal.py`). A
heading that does not come back is `None` and the screen says the agent did not state it.
Nothing is filled in — an acceptance criterion this product wrote itself would be this
product grading its own homework.

**The boundary is the same as the first pass.** The brief is built from `brief.build`, so the
same scrub, the same disclosure list and the same rule about what may leave the machine
apply; the question is the one new thing crossing, and it is the user's own words, shown to
them before they send it (`api/focus.py::_outbound`).

**Nothing retries** (`aiq-research/SKILL.md`). A failed pass is recorded failed and the
earlier plan, if there was one, stays.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Job, JobStep
from ..taste import context as taste_context
from . import aiq_client, brief
from .runner import REPORT_EVIDENCE

#: The question the user chose or typed, verbatim. One per item: asking a second question
#: replaces the first, because the plan below is about *a* question and two questions with
#: one plan between them is the ambiguity this whole flow exists to remove.
QUESTION_EVIDENCE = "lab.question"

#: AI-Q's answer to it — goal, criteria and plan, stored verbatim like every other report.
PLAN_EVIDENCE = "lab.plan_report"

#: What left the machine to get it.
PLAN_BRIEF_EVIDENCE = "lab.plan_brief"

STEPS = (
    ("question", "질문을 검증 가능한 형태로 정리한다"),
    ("brief", "이 질문으로 조사 요청을 만든다"),
    ("plan", "NVIDIA AI-Q가 검증 기준과 Trial Plan을 설계한다"),
)

#: The headings the answer must carry. Asked for by name so `proposal.py` can find them by
#: name; a free-form answer would be parsed by guesswork, and a guess here becomes a success
#: condition the user never agreed to.
PLAN_QUESTIONS = (
    "### 1. Verification goal\n"
    "One sentence: what, exactly, would answer the user's question for *this* subject. "
    "Do not restate the question; say what has to be established.",
    "### 2. Acceptance criteria\n"
    "A short list of observable results that would settle it, and what each one would mean. "
    "Observable means visible in a terminal inside a sandbox with no GPU, no Docker and no "
    "network except the hosts the plan names. If the question cannot be settled that way, "
    "say so plainly and give the closest thing that can.",
    "### 3. Trial plan\n"
    "The smallest sequence of steps that would produce those observations, with the exact "
    "commands. Prefer running from source over any path that needs a container or an "
    "interpreter download.",
)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True, slots=True)
class PlanOutcome:
    job_id: str
    state: str
    question: str
    server_url: str | None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "state": self.state,
            "question": self.question,
            "serverUrl": self.server_url,
            "error": self.error,
        }


def build_query(context: Any, question: str, report: str | None) -> str:
    """The brief for the planning pass.

    Built on top of `brief.build` rather than beside it: that function is where the
    boundary in `CLAUDE.md` §3 is enforced, and a second composer would be a second place
    for a field to be widened without anyone noticing. What is added here is the user's
    question and an excerpt of the first report — both already shown on screen, and the
    report is text AI-Q itself produced.
    """

    base = brief.build(context)
    lines = [line for line in base.query.splitlines()]
    # Everything from "Answer these" down is the first pass's question list; this pass asks
    # different questions of the same subject, so the subject half is kept and the rest is
    # replaced.
    for index, line in enumerate(lines):
        if line.startswith("Answer these"):
            lines = lines[:index]
            break

    lines.append("")
    lines.append(
        "The person has already seen a research report on this subject and now wants to "
        "know one specific thing. Their question, in their own words:"
    )
    lines.append("")
    lines.append(f"    {question.strip()}")
    lines.append("")
    if report:
        lines.append("What the earlier report found (your own output, for continuity):")
        lines.append("")
        lines.append(_excerpt(report))
        lines.append("")
    lines.append(
        "Design how to check it. The check runs unattended inside a Linux sandbox with "
        "git, python3 (system interpreter), pip, uv, node and npm; no Docker, no GPU, no "
        "sudo, no display, and no network beyond the hosts your plan names. It has at most "
        "15 minutes."
    )
    lines.append("")
    lines.append("Answer under exactly these three headings, with citations and source URLs:")
    lines.append("")
    lines.extend(PLAN_QUESTIONS)
    lines.append("")
    lines.append(
        "Do not claim a result. You are designing the check, not reporting it. If the "
        "question cannot be settled inside those limits, say which part cannot and plan "
        "the part that can."
    )
    return brief._scrub("\n".join(lines))


#: How much of the first report travels into the second pass.
#:
#: It is AI-Q's own text going back to AI-Q, so nothing new crosses the boundary — but a
#: 2,000-word report pasted into a prompt costs tokens and buries the question under it.
EXCERPT_CHARS = 2400


def _excerpt(report: str) -> str:
    body = report.strip()
    if len(body) <= EXCERPT_CHARS:
        return body
    return body[:EXCERPT_CHARS].rsplit("\n", 1)[0] + "\n…"


def new_job_id() -> str:
    return f"plan-{uuid.uuid4()}"


def open_job(
    session: Session,
    *,
    item_id: str,
    title: str,
    question: str,
    job_id: str | None = None,
    state: str = "running",
) -> Job:
    job = Job(
        id=job_id or new_job_id(),
        type="plan",
        state=state,
        target_id=item_id,
        # The question in the job title, so the jobs list and the Today queue say what is
        # being planned rather than only that something is.
        title=f"검증 설계 · {question.strip()[:60]}",
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


def _step(session: Session, job: Job, ordinal: int, state: str, message: str | None = None) -> None:
    row = session.scalar(
        select(JobStep).where(JobStep.job_id == job.id, JobStep.ordinal == ordinal)
    )
    if row is None:
        return
    row.state = state
    if message is not None:
        row.message = message[:500]
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


def _replace(
    session: Session, *, item_id: str, kind: str, label: str, value: str, source_url: str | None
) -> None:
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


def record_question(session: Session, item_id: str, question: str) -> None:
    """Store the question before anything is asked of anyone.

    Written first and on its own, so a planning pass that fails still leaves the screen
    able to say which question is open. A question the user asked and the product forgot is
    worse than a plan that did not arrive.

    `provenance="fact"` — it is the user's own words, not a machine's.
    """

    for row in session.scalars(
        select(Evidence).where(Evidence.item_id == item_id, Evidence.type == QUESTION_EVIDENCE)
    ).all():
        session.delete(row)
    session.flush()
    session.add(
        Evidence(
            item_id=item_id,
            type=QUESTION_EVIDENCE,
            label="확인하고 싶은 것",
            value=question.strip(),
            provenance="fact",
            source_url=None,
            observed_at=_now(),
        )
    )
    session.flush()


def run(
    session: Session,
    item_id: str,
    question: str,
    *,
    agent_type: str = "shallow_researcher",
    server_url: str | None = None,
    timeout: float = aiq_client.DEFAULT_TIMEOUT_SECONDS,
    job_id: str | None = None,
) -> PlanOutcome:
    """Plan how to verify one question about one item."""

    subject = taste_context.build(session, item_id)
    if subject is None:
        raise LookupError(f"no item {item_id!r}")

    job = session.get(Job, job_id) if job_id else None
    if job is None:
        job = open_job(session, item_id=item_id, title=subject.title, question=question)
    else:
        job.state = "running"
        job.started_at = _now()
        session.flush()
    session.commit()

    try:
        _step(session, job, 0, "running")
        record_question(session, item_id, question)
        _step(session, job, 0, "done")

        _step(session, job, 1, "running")
        earlier = session.scalar(
            select(Evidence).where(Evidence.item_id == item_id, Evidence.type == REPORT_EVIDENCE)
        )
        query = build_query(subject, question, earlier.value if earlier else None)
        _replace(
            session,
            item_id=item_id,
            kind=PLAN_BRIEF_EVIDENCE,
            label="이 기계를 떠난 검증 설계 요청",
            value=query,
            source_url=None,
        )
        _step(session, job, 1, "done")
        session.commit()

        _step(session, job, 2, "running")
        session.commit()
        resolved = aiq_client.resolve_server(server_url)
        answer = aiq_client.research(
            query, agent_type=agent_type, server_url=resolved, timeout=timeout
        )
        if not answer.has_report:
            _step(session, job, 2, "failed", "AI-Q가 리포트 없이 끝났습니다")
            _finish(session, job, "failed")
            session.commit()
            return PlanOutcome(
                job_id=job.id,
                state="failed",
                question=question,
                server_url=resolved,
                error="AI-Q가 리포트 없이 끝났습니다",
            )

        _replace(
            session,
            item_id=item_id,
            kind=PLAN_EVIDENCE,
            label="질문 기반 검증 설계",
            # Verbatim, citations and URLs intact — same rule as the first pass.
            value=answer.report,
            source_url=(answer.job_id and f"{resolved}/v1/jobs/{answer.job_id}") or resolved,
        )
        _step(session, job, 2, "done")
        _finish(session, job, "succeeded")
        session.commit()
        return PlanOutcome(job_id=job.id, state="succeeded", question=question, server_url=resolved)

    except aiq_client.AiqUnavailable as error:
        session.rollback()
        reopened = session.get(Job, job.id)
        if reopened is not None:
            for ordinal in range(len(STEPS)):
                row = session.scalar(
                    select(JobStep).where(JobStep.job_id == reopened.id, JobStep.ordinal == ordinal)
                )
                if row is not None and row.state in ("running", "waiting"):
                    row.state = "failed" if row.state == "running" else "skipped"
                    row.message = str(error)[:500] if row.state == "failed" else row.message
                    row.finished_at = _now()
            _finish(session, reopened, "failed")
            session.commit()
        return PlanOutcome(
            job_id=job.id,
            state="failed",
            question=question,
            server_url=None,
            error=str(error),
        )


def latest(session: Session, item_id: str) -> dict[str, Any] | None:
    """The open question and the plan AI-Q designed for it, if either exists.

    The question alone is a real state and is returned without a plan: it means the pass
    failed or is still going, and the screen has to be able to say so rather than showing
    the pre-question suggestion as though nobody had asked anything.
    """

    rows = {
        row.type: row
        for row in session.scalars(
            select(Evidence)
            .where(Evidence.item_id == item_id)
            .where(Evidence.type.in_([QUESTION_EVIDENCE, PLAN_EVIDENCE, PLAN_BRIEF_EVIDENCE]))
        ).all()
    }
    question = rows.get(QUESTION_EVIDENCE)
    if question is None:
        return None
    plan = rows.get(PLAN_EVIDENCE)
    return {
        "question": question.value,
        "askedAt": question.observed_at,
        "report": plan.value if plan else None,
        "observedAt": plan.observed_at if plan else None,
        "sourceUrl": plan.source_url if plan else None,
        "brief": rows[PLAN_BRIEF_EVIDENCE].value if PLAN_BRIEF_EVIDENCE in rows else None,
    }


__all__ = [
    "PLAN_BRIEF_EVIDENCE",
    "PLAN_EVIDENCE",
    "PLAN_QUESTIONS",
    "QUESTION_EVIDENCE",
    "STEPS",
    "PlanOutcome",
    "build_query",
    "latest",
    "new_job_id",
    "open_job",
    "record_question",
    "run",
]
