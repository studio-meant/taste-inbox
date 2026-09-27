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

from typing import Any

from sqlalchemy.orm import Session

from ..action import proposal
from ..db.models import Evidence, Item
from ..research import runner as research_runner
from ..sandbox import nemoclaw, trial as trial_runner
from ..taste import context as taste_context

#: Evidence the paper bundle put on an item. Grouped out of the flat evidence list because
#: the card draws them as branches of one thing rather than as separate findings.
_BUNDLE_PREFIX = "paper."


def _bundle(session: Session, item_id: str) -> dict[str, Any] | None:
    from sqlalchemy import select

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
            else ("author-linked" if (repo[0]["confidence"] or 0) >= 1.0 else "auto-linked")
        ),
        "projectPage": (gather("project_page") or [None])[0],
        "models": gather("linked_model"),
        "datasets": gather("linked_dataset"),
        "spaces": gather("linked_space"),
        "totals": {
            kind: int(rows_[0]["value"])
            for kind in ("models", "datasets", "spaces")
            if (rows_ := gather(f"total_{kind}")) and rows_[0]["value"].isdigit()
        },
    }


def payload(session: Session, item_id: str) -> dict[str, Any] | None:
    """The whole screen, or None when there is no such item."""

    item = session.get(Item, item_id)
    if item is None:
        return None

    context = taste_context.build(session, item_id)
    research = research_runner.latest(session, item_id)
    trial = trial_runner.latest(session, item_id)

    suggestion: dict[str, Any] | None = None
    if research and research.get("report"):
        built = proposal.build(
            subject_id=item_id,
            subject_title=item.title or item.canonical_url,
            subject_url=item.canonical_url,
            report=research["report"],
        )
        suggestion = built.as_dict()

    # Read rather than assumed: the card says which sandbox and which policies a trial
    # would run under, and it has to be true at the moment the person is looking.
    try:
        boundary = nemoclaw.status()
    except nemoclaw.SandboxUnavailable as error:
        boundary = {"sandbox": nemoclaw.sandbox_name(), "ready": False, "policies": [], "raw": str(error)}

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
            "firstSeenAt": item.first_seen_at,
        },
        "context": context.as_dict() if context else None,
        "bundle": _bundle(session, item_id),
        "research": research,
        "suggestion": suggestion,
        "trial": trial,
        "boundary": {
            "sandbox": boundary["sandbox"],
            "ready": boundary["ready"],
            # Busy is not "not ready": another trial holds the host lock, and the screen
            # should say "wait" rather than "the boundary is missing".
            "busy": bool(boundary.get("busy")),
            "policies": boundary["policies"],
        },
    }


__all__ = ["payload"]
