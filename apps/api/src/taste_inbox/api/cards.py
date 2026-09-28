"""Turn database rows into the card models the frontend already renders.

This is the Python mirror of `apps/web/src/lib/mock/mappers.ts`, and it obeys the same
rule: **an unenriched item must not look enriched.** Nothing here fills a gap with a
plausible value. `checkedAt` is null because no enricher has looked, not because a lookup
failed, and a field no producer will ever fill is removed rather than sent as a null.

Field names are camelCase because they cross to TypeScript and are validated there against
the zod schemas in `packages/shared/src/domain/`. A name that disagrees with those schemas
is a runtime error on the other side, which is the intended coupling.

**One list.** Every collected item — a starred repository, a liked model, dataset or Space,
an upvoted or cited paper, a link added by hand — is in the Inbox. The boards that split an
Instagram collection into Trends, Style, Music, Places and None, and the classifier, photo
gallery, shop links and song matching that served them, were removed on 2026-09-28
(docs/DECISIONS.md).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Item, ItemSource, ItemTag
from ..ingest.captures import LINK_TYPES

PLATFORM_LABEL: dict[str, str] = {
    "github": "GitHub",
    "huggingface": "Hugging Face",
    "arxiv": "arXiv",
    "web": "웹",
}


def inbox_query() -> Select[tuple[Item]]:
    """Every item, newest first, ties broken by id so two reads agree on the order."""
    return select(Item).order_by(Item.first_seen_at.desc(), Item.id)


def count_items(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(Item)) or 0


def tags_of(session: Session, item: Item) -> list[str]:
    return list(
        session.scalars(
            select(ItemTag.tag).where(ItemTag.item_id == item.id).order_by(ItemTag.ordinal)
        )
    )


def _membership(session: Session, item: Item) -> ItemSource | None:
    """The signal a card names. A person's own act on the item — a star, an upvote — before
    a like that only reached it through a model that cites it."""
    return session.scalar(
        select(ItemSource)
        .where(ItemSource.item_id == item.id)
        .order_by(case((ItemSource.action_type == "like", 1), else_=0), ItemSource.id)
    )


def _source_ref(session: Session, item: Item, label: str) -> dict[str, Any]:
    membership = _membership(session, item)
    return {
        "platform": item.platform,
        "label": label,
        "originalUrl": item.canonical_url,
        "author": item.author,
        "actionType": membership.action_type if membership else None,
        "firstSeenAt": item.first_seen_at,
    }


def _host_label(url: str) -> str:
    """The destination's host, without `www.`.

    A host and not a page title: a title would have to be fetched, and nothing about
    rendering a card is allowed to make a request. The host is what tells the user whether
    the click is worth making.
    """
    host = urlsplit(url).netloc.lower()
    trimmed = host[4:] if host.startswith("www.") else host
    return trimmed or url


def _links(session: Session, item: Item) -> list[dict[str, Any]]:
    """Everywhere else this item points, ready to click.

    Repositories, models and papers first — the destinations the Lab can act on — then
    plain links. A link back to the item's own host sorts last rather than being dropped:
    the card already has that link, so it is a lateral move, but a working click is never
    taken away.
    """
    rows = list(
        session.scalars(
            select(Evidence)
            .where(Evidence.item_id == item.id, Evidence.type.in_(LINK_TYPES))
            .order_by(Evidence.id)
        )
    )
    links: dict[str, dict[str, Any]] = {}
    for row in rows:
        kind = "artifact" if row.type == "artifact_link" else "outbound"
        existing = links.get(row.value)
        if existing is not None and existing["kind"] == "artifact":
            continue
        links[row.value] = {
            "id": f"{item.id}-link-{row.id}",
            "url": row.value,
            "label": _host_label(row.value),
            "kind": kind,
        }

    own_host = _host_label(item.canonical_url)
    return sorted(
        links.values(),
        key=lambda link: (link["label"] == own_host, link["kind"] != "artifact"),
    )


def _headline(item: Item, fallback: str) -> str:
    """The first line worth showing, or an honest placeholder — never a fabricated title."""
    if item.title:
        return item.title
    for line in (item.body_text or "").split("\n"):
        candidate = line.strip()
        if candidate and not candidate.startswith("#"):
            return candidate[:80]
    return fallback


def _label(item: Item) -> str:
    return PLATFORM_LABEL.get(item.platform, item.platform)


def to_ai_card(session: Session, item: Item) -> dict[str, Any]:
    return {
        "id": item.id,
        "kind": item.kind,
        "title": _headline(item, "저장한 항목"),
        # The whole text, not a slice of it. Shortening for display is the card's job, and
        # it already clamps; doing it here would lose the text before anyone could expand it.
        "summary": (item.body_text or "") or "본문이 없습니다.",
        "checkedAt": item.checked_at,
        "tags": tags_of(session, item),
        "links": _links(session, item),
        "source": _source_ref(session, item, _label(item)),
    }


def generated_at() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


#: Evidence rows that are already rendered as something else on the detail page, so showing
#: them again in the observation list would be the same fact twice. `_links` turns the link
#: rows into clickable chips, which is a better presentation of a URL than a table row.
EVIDENCE_SHOWN_ELSEWHERE: frozenset[str] = frozenset(LINK_TYPES)


def _all_evidence(session: Session, item: Item) -> list[dict[str, Any]]:
    """Every observation attached to this item, grouped by kind.

    Ordered by type then id so the page reads as groups rather than as insertion order.
    """
    rows = session.scalars(
        select(Evidence).where(Evidence.item_id == item.id).order_by(Evidence.type, Evidence.id)
    )
    return [
        {
            "id": f"{item.id}-ev-{row.id}",
            "type": row.type,
            "label": row.label,
            "value": row.value,
            "provenance": row.provenance,
            "sourceUrl": row.source_url,
            "observedAt": row.observed_at,
            "confidence": row.confidence,
        }
        for row in rows
        if row.type not in EVIDENCE_SHOWN_ELSEWHERE and row.value.strip()
    ]


def to_item_detail(session: Session, item: Item) -> dict[str, Any]:
    """One item, whole — the screen someone opens *because* the card was too short."""
    return {
        "id": item.id,
        "kind": item.kind,
        "title": _headline(item, "저장한 항목"),
        "body": item.body_text or "",
        "source": _source_ref(session, item, _label(item)),
        "tags": tags_of(session, item),
        "links": _links(session, item),
        "evidence": _all_evidence(session, item),
        "sourcePublishedAt": item.source_published_at,
        "checkedAt": item.checked_at,
        "firstSeenAt": item.first_seen_at,
    }


__all__ = [
    "PLATFORM_LABEL",
    "count_items",
    "generated_at",
    "inbox_query",
    "tags_of",
    "to_ai_card",
    "to_item_detail",
]
