"""What this user's saved history says about one item.

A `TasteContext` answers "why might this matter to *you*" with rows rather than with a
guess: the terms that recur across what you saved, the ones this item shares with them,
the neighbours that share them, and how recently you have been saving this kind of thing.

**Every field carries the ids it came from.** That is not decoration — the context is the
thing that goes into a research brief, and a brief is the only part of this product that
leaves the machine (`CLAUDE.md` §3). Being able to point at the rows behind a term is how
that send stays reviewable.

**Nothing here calls a model.** It is SQL and counting, so it is reproducible: the same
database produces the same context, and two research runs over the same item can be
compared. The moment this file starts inferring, the citation trail behind every
suggestion loses its first link.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Item, ItemSource, ItemTag
from . import vocabulary

#: How far back "recently" reaches when describing the user's current attention.
RECENT_DAYS = 30

#: How many neighbours a context names. Enough to show a pattern, few enough that a brief
#: stays a question rather than becoming a dump of the library.
MAX_NEIGHBOURS = 6

#: How many shared terms are carried. Beyond this they stop separating anything.
MAX_TERMS = 12


@dataclass(frozen=True, slots=True)
class Neighbour:
    """Another saved item that shares ground with the subject."""

    item_id: str
    title: str
    kind: str
    platform: str
    canonical_url: str
    #: Which terms it shares. The reason it is here, in the user's own collected words.
    shared_terms: list[str]
    action_at: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "itemId": self.item_id,
            "title": self.title,
            "kind": self.kind,
            "platform": self.platform,
            "canonicalUrl": self.canonical_url,
            "sharedTerms": self.shared_terms,
            "actionAt": self.action_at,
        }


@dataclass(frozen=True, slots=True)
class TasteContext:
    """The subject, and what the rest of the library says about it."""

    item_id: str
    title: str
    kind: str
    platform: str
    canonical_url: str
    #: The subject's own terms, normalised.
    item_terms: list[str]
    #: Terms that recur across the library, with how many items carry each.
    recurring_terms: list[tuple[str, int]]
    #: The intersection — why this item is not arriving into an empty room.
    shared_terms: list[str]
    neighbours: list[Neighbour]
    #: What the user has been saving lately, as `kind → count` over `RECENT_DAYS`.
    recent_kinds: dict[str, int]
    recent_total: int
    #: Facts the sources stated about the subject (a paper's repository, its demos).
    stated: list[dict[str, Any]] = field(default_factory=list)
    #: Every row id this context was built from, so a reviewer can walk back.
    evidence_item_ids: list[str] = field(default_factory=list)

    @property
    def is_grounded(self) -> bool:
        """Whether the library actually connects to this item.

        A context with no shared terms and no neighbours is honest but weak, and the
        research brief must say so rather than implying a connection it does not have.
        """

        return bool(self.shared_terms) or bool(self.neighbours)

    def as_dict(self) -> dict[str, Any]:
        return {
            "itemId": self.item_id,
            "title": self.title,
            "kind": self.kind,
            "platform": self.platform,
            "canonicalUrl": self.canonical_url,
            "itemTerms": self.item_terms,
            "recurringTerms": [
                {"term": term, "itemCount": count} for term, count in self.recurring_terms
            ],
            "sharedTerms": self.shared_terms,
            "neighbours": [neighbour.as_dict() for neighbour in self.neighbours],
            "recentKinds": self.recent_kinds,
            "recentTotal": self.recent_total,
            "stated": self.stated,
            "evidenceItemIds": self.evidence_item_ids,
            "grounded": self.is_grounded,
        }


def _tags_of(session: Session, item_ids: list[str]) -> dict[str, list[str]]:
    if not item_ids:
        return {}
    rows = session.scalars(
        select(ItemTag).where(ItemTag.item_id.in_(item_ids)).order_by(ItemTag.ordinal)
    ).all()
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row.item_id, []).append(row.tag)
    return grouped


def _recent_cutoff(now: datetime | None = None) -> str:
    moment = (now or datetime.now(UTC)) - timedelta(days=RECENT_DAYS)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def build(session: Session, item_id: str, *, now: datetime | None = None) -> TasteContext | None:
    """Assemble the context for one item, or None when the item is unknown."""

    subject = session.get(Item, item_id)
    if subject is None:
        return None

    # The library, minus the subject. Bounded by recency rather than by taking everything:
    # a context is about current attention, and a repository starred two years ago is
    # history rather than taste.
    cutoff = _recent_cutoff(now)
    library = session.scalars(
        select(Item)
        .where(Item.id != item_id)
        .where(Item.first_seen_at >= cutoff)
        .order_by(Item.first_seen_at.desc())
    ).all()

    all_ids = [subject.id, *[row.id for row in library]]
    tags = _tags_of(session, all_ids)

    subject_terms = vocabulary.terms_of(tags.get(subject.id, []))
    recurring = vocabulary.rank(
        (tags.get(row.id, []) for row in library), limit=MAX_TERMS, minimum=2
    )
    recurring_names = {term for term, _ in recurring}
    shared = [term for term in subject_terms if term in recurring_names]

    neighbours: list[Neighbour] = []
    if subject_terms:
        subject_set = set(subject_terms)
        scored: list[tuple[int, str, Item, list[str]]] = []
        for row in library:
            overlap = [
                term for term in vocabulary.terms_of(tags.get(row.id, [])) if term in subject_set
            ]
            if overlap:
                # Sorted by how much they share, then by title so equal scores are stable.
                scored.append((len(overlap), row.title or row.canonical_url, row, overlap))
        scored.sort(key=lambda entry: (-entry[0], entry[1]))
        for _, _, row, overlap in scored[:MAX_NEIGHBOURS]:
            action_at = session.scalar(
                select(ItemSource.action_at).where(ItemSource.item_id == row.id).limit(1)
            )
            neighbours.append(
                Neighbour(
                    item_id=row.id,
                    title=row.title or row.canonical_url,
                    kind=row.kind,
                    platform=row.platform,
                    canonical_url=row.canonical_url,
                    shared_terms=overlap,
                    action_at=action_at,
                )
            )

    recent_kinds: dict[str, int] = {}
    for row in library:
        recent_kinds[row.kind] = recent_kinds.get(row.kind, 0) + 1

    stated = [
        {
            "type": row.type,
            "label": row.label,
            "value": row.value,
            "sourceUrl": row.source_url,
            "provenance": row.provenance,
            "confidence": row.confidence,
        }
        for row in session.scalars(
            select(Evidence).where(Evidence.item_id == subject.id).order_by(Evidence.id)
        ).all()
    ]

    return TasteContext(
        item_id=subject.id,
        title=subject.title or subject.canonical_url,
        kind=subject.kind,
        platform=subject.platform,
        canonical_url=subject.canonical_url,
        item_terms=subject_terms,
        recurring_terms=recurring,
        shared_terms=shared,
        neighbours=neighbours,
        recent_kinds=recent_kinds,
        recent_total=len(library),
        stated=stated,
        evidence_item_ids=[subject.id, *[n.item_id for n in neighbours]],
    )


__all__ = ["MAX_NEIGHBOURS", "MAX_TERMS", "RECENT_DAYS", "Neighbour", "TasteContext", "build"]
