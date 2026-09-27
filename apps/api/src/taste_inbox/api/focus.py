"""`GET /api/focus/{item_id}` — everything the Focus Canvas draws, in one payload.

One request rather than four, because the screen is a single statement about a single
item and four round trips would let it render in inconsistent halves: research from one
moment, a trial from another.

**Every section may be absent, and absence is a state the screen has a design for.** An
item with no research is not an error; it is an item nobody has researched yet. What this
payload must never do is fill a gap with something plausible — the inherited
`api/today.py` returns an empty working queue rather than inventing activity, and this is
the same rule on a different screen.
"""

from __future__ import annotations

import threading
import time
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..action import proposal, questions
from ..db.models import Evidence, Item, Job, JobStep
from ..research import question as question_runner
from ..research import runner as research_runner
from ..sandbox import nemoclaw
from ..sandbox import policy as sandbox_policy
from ..sandbox import trial as trial_runner
from ..taste import context as taste_context

#: Evidence the paper bundle put on an item. Grouped out of the flat evidence list because
#: the card draws them as branches of one thing rather than as separate findings.
_BUNDLE_PREFIX = "paper."


#: How long one `nemoclaw status` answer is reused. The call takes ~3 s, and the page is
#: rendered on every navigation; a boundary does not change between two clicks.
BOUNDARY_TTL_SECONDS = 15.0

_boundary_cache: tuple[float, dict[str, Any]] | None = None
_boundary_lock = threading.Lock()


def _boundary() -> dict[str, Any]:
    global _boundary_cache
    with _boundary_lock:
        if _boundary_cache and time.monotonic() - _boundary_cache[0] < BOUNDARY_TTL_SECONDS:
            return _boundary_cache[1]
    try:
        state = nemoclaw.status()
    except nemoclaw.SandboxUnavailable as error:
        state = {
            "sandbox": nemoclaw.sandbox_name(),
            "ready": False,
            "busy": False,
            "policies": [],
            "endpoints": [],
            "reason": str(error),
        }
    with _boundary_lock:
        _boundary_cache = (time.monotonic(), state)
    return state


def forget_boundary() -> None:
    """Drop the cached status, so the next read is fresh. For tests and after a trial."""

    global _boundary_cache
    with _boundary_lock:
        _boundary_cache = None


def _latest_job(session: Session, item_id: str, kind: str) -> dict[str, Any] | None:
    """The newest job of one kind on this item, with its steps.

    The evidence says what the last *finished* run found; this says what is happening
    now, or how the last attempt ended. A failed research run leaves the older report in
    place, and the screen has to be able to say both.
    """

    job = session.scalars(
        select(Job)
        .where(Job.target_id == item_id, Job.type == kind)
        .order_by(Job.created_at.desc(), Job.id.desc())
        .limit(1)
    ).first()
    if job is None:
        return None
    steps = session.scalars(
        select(JobStep).where(JobStep.job_id == job.id).order_by(JobStep.ordinal)
    ).all()
    return {
        "id": job.id,
        "state": job.state,
        "currentStep": job.current_step,
        "createdAt": job.created_at,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        "steps": [
            {"label": step.label, "state": step.state, "message": step.message} for step in steps
        ],
    }


def _bundle(session: Session, item_id: str) -> dict[str, Any] | None:
    rows = [
        row
        for row in session.scalars(
            select(Evidence).where(Evidence.item_id == item_id).order_by(Evidence.id)
        ).all()
        if row.type.startswith(_BUNDLE_PREFIX)
    ]
    if not rows:
        return None

    def gather(kind: str) -> list[dict[str, Any]]:
        return [
            {"value": row.value, "sourceUrl": row.source_url, "confidence": row.confidence}
            for row in rows
            if row.type == f"{_BUNDLE_PREFIX}{kind}"
        ]

    repo = gather("github_repo")
    return {
        # The Official/Likely distinction the whole bundle exists to preserve. Confidence
        # 1.0 means a person linked it; 0.9 means the Hub matched it automatically.
        "repo": repo[0] if repo else None,
        "repoProvenance": (
            None
            if not repo
            else ("person-linked" if (repo[0]["confidence"] or 0) >= 1.0 else "auto-linked")
        ),
        "projectPage": next(iter(gather("project_page")), None),
        "models": gather("linked_model"),
        "datasets": gather("linked_dataset"),
        "spaces": gather("linked_space"),
        "totals": {
            kind: int(rows_[0]["value"])
            for kind in ("models", "datasets", "spaces")
            if (rows_ := gather(f"total_{kind}")) and rows_[0]["value"].isdigit()
        },
    }


def _outbound(context: Any) -> dict[str, Any]:
    """What a research run *would* send, and where — before anything is sent.

    `CLAUDE.md` §3: the screen says what leaves and to where, rather than claiming nothing
    does. The brief is deterministic, so this is exactly the text the run will send; and
    the destination is resolved the same way the run resolves it, so an unset or refused
    `AIQ_SERVER_URL` is shown here as the reason the button will refuse.
    """

    from ..research import aiq_client, brief

    query = brief.build(context).query if context is not None else None
    try:
        server_url = aiq_client.resolve_server()
    except aiq_client.AiqUnavailable as error:
        return {"serverUrl": None, "local": None, "query": query, "error": str(error)}
    host = urlsplit(server_url).hostname
    return {
        "serverUrl": server_url,
        "local": host in ("localhost", "127.0.0.1", "::1"),
        "query": query,
        "error": None,
    }


def current_suggestion(
    session: Session, item: Item
) -> tuple[proposal.SuggestedAction | None, dict[str, Any] | None]:
    """The trial as it stands for this item, and the question behind it if there is one.

    **One composer, called by both readers.** `GET /api/focus` draws this and
    `POST /api/trials` runs it, and the second must run exactly what the first showed. They
    each built their own before this existed, which was fine only for as long as there was
    one way to build it; a question that changes the plan makes two builders two plans, and
    the user would approve one and get the other.
    """

    research = research_runner.latest(session, item.id)
    asked = question_runner.latest(session, item.id)
    if not research or not research.get("report"):
        return None, asked

    built = proposal.build(
        subject_id=item.id,
        subject_title=item.title or item.canonical_url,
        subject_url=item.canonical_url,
        report=research["report"],
        question=(asked or {}).get("question"),
        plan_report=(asked or {}).get("report"),
    )
    return built, asked


def payload(session: Session, item_id: str) -> dict[str, Any] | None:
    """The whole screen, or None when there is no such item."""

    item = session.get(Item, item_id)
    if item is None:
        return None

    context = taste_context.build(session, item_id)
    research = research_runner.latest(session, item_id)
    trial = trial_runner.latest(session, item_id)
    bundle = _bundle(session, item_id)

    built, asked = current_suggestion(session, item)
    suggestion = built.as_dict() if built else None

    # Read rather than assumed: the card says which sandbox and which policies a trial
    # would run under, and it has to be true at the moment the person is looking.
    boundary = _boundary()

    return {
        "item": {
            "id": item.id,
            "kind": item.kind,
            "platform": item.platform,
            "title": item.title or item.canonical_url,
            "summary": item.body_text,
            "canonicalUrl": item.canonical_url,
            "author": item.author,
            # The item's own stamp first: it is the one every collector writes. The
            # per-source value exists for items that arrived through more than one signal.
            "actionAt": item.action_at
            or next((source.action_at for source in item.sources if source.action_at), None),
            # What the user actually did — star, like, upvote. The canvas printed a label
            # keyed by *platform* before this, which said 좋아요 on an upvoted paper.
            "actionType": next(
                (source.action_type for source in item.sources if source.action_type), None
            ),
            "firstSeenAt": item.first_seen_at,
        },
        "context": context.as_dict() if context else None,
        "outbound": _outbound(context),
        "bundle": bundle,
        "research": research,
        "asked": asked,
        # Offered only once there is something to ask *about*. Before research the Lab has
        # nothing to condition a question on, and four generic chips would be a guess
        # dressed as a suggestion.
        "suggestedQuestions": [
            row.as_dict()
            for row in questions.build(
                kind=item.kind,
                title=item.title or item.canonical_url,
                platform=item.platform,
                bundle=bundle,
                context=context.as_dict() if context else None,
                has_research=bool(research and research.get("report")),
                actionable=built.actionable if built else None,
            )
        ],
        "suggestion": suggestion,
        "trial": trial,
        "jobs": {
            "research": _latest_job(session, item_id, "research"),
            "plan": _latest_job(session, item_id, "plan"),
            "trial": _latest_job(session, item_id, "trial"),
        },
        "boundary": {
            "sandbox": boundary["sandbox"],
            "ready": boundary["ready"],
            # Busy is not "not ready": another trial holds the host lock, and the screen
            # should say "wait" rather than "the boundary is missing".
            "busy": bool(boundary.get("busy")),
            "policies": boundary["policies"],
            # Unknowable while busy: the lock hides the policy list (see `policy.check`).
            "missingPresets": []
            if boundary.get("busy")
            else [
                preset
                for preset in sandbox_policy.REQUIRED_PRESETS
                if preset not in boundary["policies"]
            ],
            "endpoints": boundary.get("endpoints") or [],
            "reason": boundary.get("reason"),
        },
    }


__all__ = ["BOUNDARY_TTL_SECONDS", "current_suggestion", "forget_boundary", "payload"]
