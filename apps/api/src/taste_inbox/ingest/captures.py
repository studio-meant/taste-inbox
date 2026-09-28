"""Read what the collectors wrote, and put it in the database.

One capture shape arrives here: a `SourceItem` list per surface, written by the GitHub
Stars and Hugging Face collectors in `services/collectors` (`capture_file.py`). Each record
already carries a platform and a canonical URL, so every surface becomes the same rows —
that is the point of `items` being platform-agnostic.

Ingestion is **idempotent**. Running it twice does not duplicate anything, and it never
overwrites `first_seen_at`: the first time Taste Inbox saw an item is a fact about the
past, and re-reading the same file later must not restate it as today.

The Instagram, Threads and LinkedIn readers — and the media cache, profile reader and
shortener resolver that served them — were removed on 2026-09-28 (docs/DECISIONS.md).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import (
    Evidence,
    Item,
    ItemSource,
    ItemTag,
    RawEvent,
    SourceAccount,
)
from ..paths import REPO_ROOT

CAPTURE_DIR: Path = REPO_ROOT / "var" / "captures"

#: The collectors' surfaces, and the `(platform, action)` each one records.
#:
#: `huggingface_activity` carries `like` even for the papers it resolves. Nobody upvoted
#: those papers; they arrived because a liked model cites them, and claiming an upvote
#: would invent a signal the user never gave (`api_sources/huggingface/papers.py`).
#:
#: `huggingface_upvotes` is the other half of that sentence and is why it is a second row
#: rather than more of the first: there the user *did* act on the paper, so the action is
#: `upvote` and `action_at` is the upvote's own time. One item collected both ways ends up
#: with two `item_sources` rows over one `items` row, which is exactly what that table is
#: for — the same paper, reached by two signals, keeping both.
API_SURFACES: dict[str, tuple[str, str]] = {
    "github_stars_api": ("github", "star"),
    "huggingface_activity": ("huggingface", "like"),
    "huggingface_upvotes": ("huggingface", "upvote"),
}

#: Every surface whose capture file `ingest_source_file` can read.
SOURCE_SURFACES: dict[str, tuple[str, str]] = dict(API_SURFACES)


@dataclass(slots=True)
class IngestReport:
    """What one ingestion run changed, so a quiet no-op is distinguishable from a failure."""

    files_read: int = 0
    items_new: int = 0
    items_updated: int = 0
    #: Seen again with nothing to change — the normal result of a quiet day.
    items_unchanged: int = 0
    memberships_new: int = 0
    raw_events: int = 0
    skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "files_read": self.files_read,
            "items_new": self.items_new,
            "items_updated": self.items_updated,
            "items_unchanged": self.items_unchanged,
            "memberships_new": self.memberships_new,
            "raw_events": self.raw_events,
            "skipped": self.skipped,
        }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


# ------------------------------------------------------------------ accounts


def ensure_account(
    session: Session, platform: str, handle: str | None, label: str
) -> SourceAccount:
    existing = session.scalar(
        select(SourceAccount).where(
            SourceAccount.platform == platform, SourceAccount.handle == handle
        )
    )
    if existing is not None:
        return existing
    account = SourceAccount(
        platform=platform,
        handle=handle,
        label=label,
        enabled=1,
        state="collected",
        connected_at=_now(),
    )
    session.add(account)
    session.flush()
    return account


# --------------------------------------------------------------------- items


def upsert_item(
    session: Session,
    *,
    platform: str,
    platform_item_id: str,
    canonical_url: str,
    kind: str,
    title: str | None,
    body_text: str | None,
    author: str | None,
    source_published_at: str | None,
    action_at: str | None,
    report: IngestReport,
    previous_item_id: str | None = None,
    first_seen_at: str | None = None,
) -> Item:
    """Insert or refresh one item, keyed on `(platform, platform_item_id)`.

    `first_seen_at` is written once and never again. It defaults to now because every
    capture overwrites one fixed file and is read the same run it is written, so "when this
    run read it" and "when the collector saw it" are the same instant. Only used on insert —
    a later capture cannot restate when this product first saw something.

    `previous_item_id` is the id an earlier capture used for the same thing, supplied when a
    collector learns a better one. With it the row is adopted rather than duplicated: same
    `items.id`, so nothing that references it has to move.

    A later capture may be *thinner* than an earlier one without the item having changed —
    a repository whose description was cleared, a model card that stopped naming a date.
    So a null never replaces a value. The cost is that genuinely deleting a caption on the
    platform leaves the old text here; that is the better failure, because it is visible
    and rare, while silent erasure is neither.
    """

    def prefer(new: str | None, old: str | None) -> str | None:
        return new if new is not None else old

    existing = session.scalar(
        select(Item).where(Item.platform == platform, Item.platform_item_id == platform_item_id)
    )
    if existing is None and previous_item_id:
        existing = session.scalar(
            select(Item).where(Item.platform == platform, Item.platform_item_id == previous_item_id)
        )
        if existing is not None:
            # Same thing, better name for it. Recorded as an update rather than a new item,
            # because nothing about the post changed — only what this product calls it.
            existing.platform_item_id = platform_item_id
    now = _now()

    if existing is None:
        item = Item(
            id=str(uuid.uuid4()),
            kind=kind,
            platform=platform,
            platform_item_id=platform_item_id,
            canonical_url=canonical_url,
            title=title,
            body_text=body_text,
            author=author,
            first_seen_at=first_seen_at or now,
            source_published_at=source_published_at,
            action_at=action_at,
            checked_at=None,
            updated_at=now,
        )
        session.add(item)
        session.flush()
        report.items_new += 1
        return item

    merged_author = prefer(author, existing.author)
    merged_title = prefer(title, existing.title)
    merged_body = prefer(body_text, existing.body_text)
    merged_published = prefer(source_published_at, existing.source_published_at)
    merged_action = prefer(action_at, existing.action_at)

    changed = (
        existing.canonical_url != canonical_url
        or existing.kind != kind
        or existing.author != merged_author
        or existing.title != merged_title
        or existing.body_text != merged_body
        or existing.source_published_at != merged_published
        or existing.action_at != merged_action
    )

    existing.canonical_url = canonical_url
    existing.kind = kind
    existing.author = merged_author
    existing.title = merged_title
    existing.body_text = merged_body
    existing.source_published_at = merged_published
    existing.action_at = merged_action

    if changed:
        # `updated_at` means "when this row last changed" (db/models.py). A daily re-read
        # of an unchanged file must not move it, or the column stops meaning anything and
        # every stale badge in the UI reads as fresh.
        existing.updated_at = now
        report.items_updated += 1
    else:
        report.items_unchanged += 1
    return existing


def set_tags(session: Session, item: Item, tags: Iterable[str]) -> None:
    wanted = list(dict.fromkeys(tags))
    session.query(ItemTag).filter(ItemTag.item_id == item.id).delete()
    for ordinal, tag in enumerate(wanted):
        session.add(ItemTag(item_id=item.id, tag=tag, ordinal=ordinal))


def record_membership(
    session: Session,
    *,
    item: Item,
    account: SourceAccount,
    action_type: str | None,
    position: int | None,
    report: IngestReport,
    first_seen_at: str | None = None,
    action_at: str | None = None,
) -> None:
    existing = session.scalar(
        select(ItemSource).where(
            ItemSource.item_id == item.id,
            ItemSource.source_account_id == account.id,
            ItemSource.action_type == action_type,
        )
    )
    if existing is not None:
        existing.position = position
        # A membership recorded before the API collectors existed has a null `action_at`.
        # Backfilling it here is how those rows gain the timestamp without a migration.
        if existing.action_at is None and action_at:
            existing.action_at = action_at
        return
    session.add(
        ItemSource(
            item_id=item.id,
            source_account_id=account.id,
            action_type=action_type,
            position=position,
            first_seen_at=first_seen_at or _now(),
            # GitHub's `starred_at` under the star+json media type, Hugging Face's
            # `createdAt` on a like, the upvote's own time.
            action_at=action_at,
        )
    )
    report.memberships_new += 1


#: Hosts whose links name a concrete artifact rather than an article.
ARTIFACT_HOSTS: tuple[str, ...] = ("github.com", "huggingface.co", "arxiv.org")

#: The evidence types `record_links` writes, and the only ones `api/cards.py` renders as links.
LINK_TYPES: tuple[str, ...] = ("artifact_link", "outbound_link")


def classify_link(url: str) -> str:
    if any(host in url for host in ARTIFACT_HOSTS):
        return "artifact_link"
    return "outbound_link"


def record_links(session: Session, *, item: Item, urls: list[str]) -> None:
    """Keep the links an item carried — a repository's homepage, a paper's code and demos.

    Stored as evidence with `provenance="fact"`: the link was observed in what the source
    returned, and nothing about the page behind it is claimed.
    """
    seen = {
        row.value
        for row in session.scalars(
            select(Evidence).where(Evidence.item_id == item.id, Evidence.type.in_(LINK_TYPES))
        )
    }
    for url in urls:
        if not url or url in seen:
            continue
        seen.add(url)
        kind = classify_link(url)
        session.add(
            Evidence(
                item_id=item.id,
                type=kind,
                label={
                    "artifact_link": "포함된 저장소·모델 링크",
                    "outbound_link": "포함된 링크",
                }[kind],
                value=url,
                provenance="fact",
                source_url=item.canonical_url,
                observed_at=_now(),
            )
        )


#: Evidence the *source itself stated*, as opposed to anything this product concluded.
#:
#: Written by the API collectors for a paper bundle: the Hugging Face paper document names
#: its code repository, its project page and the models and datasets that cite it, and each
#: of those is a fact with a URL behind it. The collector carries them through
#: (`capture_file.SourceItem.evidence`) rather than letting this side re-derive them,
#: because the provenance only exists at the moment of reading — `githubRepoAddedBy`
#: saying `auto` versus `user` is the whole difference between "Code · matched by the Hub"
#: and "Code · linked by a person", and it is not recoverable from the URL afterwards.
#:
#: `provenance` stays whatever the collector declared, which for these is `huggingface`.
#: It is somebody else's statement, not this product's conclusion.
STATED_EVIDENCE_PREFIX = "paper."


def record_stated_evidence(
    session: Session, *, item: Item, stated: Any, source_default: str | None = None
) -> None:
    """Store what the source declared about this item, replacing a previous reading.

    Replacing rather than appending: a paper gains linked models over time, and a run that
    added rows without clearing the last set would leave a card listing the same demo four
    times after four collections. The set is small and entirely re-readable, so the newest
    document is simply the answer.
    """

    if not isinstance(stated, list):
        return

    rows: list[dict[str, Any]] = []
    for entry in stated:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("type") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not kind or not value:
            continue
        rows.append(
            {
                "type": kind,
                "label": str(entry.get("label") or kind),
                "value": value,
                "provenance": str(entry.get("provenance") or "external"),
                "source_url": entry.get("source_url") or source_default or item.canonical_url,
                "confidence": entry.get("confidence"),
            }
        )

    if not rows:
        return

    kinds = {row["type"] for row in rows}
    existing = session.scalars(
        select(Evidence).where(Evidence.item_id == item.id, Evidence.type.in_(kinds))
    ).all()
    for stale in existing:
        session.delete(stale)
    # The deletes have to land before the inserts, or the unique-ish pairs collide within
    # one flush and SQLAlchemy orders them by insertion instead of by intent.
    session.flush()

    observed = _now()
    for row in rows:
        confidence = row["confidence"]
        session.add(
            Evidence(
                item_id=item.id,
                type=row["type"],
                label=row["label"],
                value=row["value"],
                provenance=row["provenance"],
                source_url=row["source_url"],
                observed_at=observed,
                confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
            )
        )


def ingest_source_file(session: Session, path: Path, surface: str, report: IngestReport) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    platform, action_type = SOURCE_SURFACES[surface]
    run = payload.get("run") or {}
    account = ensure_account(session, platform, None, platform.title())

    run_row = _record_run(session, surface, run, report)

    for position, raw in enumerate(payload.get("items") or []):
        platform_item_id = str(raw.get("platform_item_id") or "").strip()
        if not platform_item_id:
            report.skipped.append(f"{path.name}[{position}]: no platform id")
            continue

        canonical_url = str(raw.get("canonical_url") or "").strip()
        if not canonical_url:
            # Validated like the id above rather than coerced: `str(None)` stored the
            # literal "None", and the second such row collided on the unique index.
            report.skipped.append(f"{path.name}[{position}]: no canonical url")
            continue

        item = upsert_item(
            session,
            platform=platform,
            platform_item_id=platform_item_id,
            canonical_url=canonical_url,
            kind=str(raw.get("kind") or "post"),
            title=raw.get("title"),
            body_text=raw.get("body_text"),
            author=raw.get("owner"),
            source_published_at=raw.get("source_published_at"),
            action_at=raw.get("action_at"),
            report=report,
            # What an earlier capture called it, when the collector found a better id.
            previous_item_id=(str(raw["list_id"]) if raw.get("list_id") else None),
        )
        set_tags(session, item, raw.get("tags") or [])
        record_links(session, item=item, urls=list(raw.get("outbound_urls") or []))
        record_membership(
            session,
            item=item,
            account=account,
            action_type=action_type,
            position=position,
            report=report,
            action_at=raw.get("action_at"),
        )
        record_stated_evidence(session, item=item, stated=raw.get("evidence"))
        if run_row is not None:
            _record_raw(session, run_row.id, platform, platform_item_id, raw, report)
    report.files_read += 1


def _record_run(session: Session, surface: str, run: dict[str, Any], report: IngestReport) -> Any:
    from ..db.models import CollectorRun

    started_at = str(run.get("started_at") or _now())
    existing = session.scalar(
        select(CollectorRun).where(
            CollectorRun.collector_id == surface, CollectorRun.started_at == started_at
        )
    )
    if existing is not None:
        return existing
    row = CollectorRun(
        collector_id=surface,
        outcome=str(run.get("outcome") or "ok"),
        started_at=started_at,
        finished_at=_now(),
        scroll_passes=int(run.get("scroll_passes") or 0),
        exhausted=1 if run.get("exhausted") else 0,
        advanced_checkpoint=1 if run.get("advanced_checkpoint") else 0,
        stopped_because=str(run.get("stopped_because") or ""),
        notes=json.dumps(run.get("notes") or [], ensure_ascii=False),
    )
    session.add(row)
    session.flush()
    _update_checkpoint(session, surface, run)
    return row


def _update_checkpoint(session: Session, surface: str, run: dict[str, Any]) -> None:
    """Record how the run ended; move the stored position only if the run may move it.

    Two different facts, and only one of them is conditional.

    `last_seen_code` is where the next incremental run stops, so only a run that reached
    the previous checkpoint may advance it — moving it after a truncated run would make
    the next run stop at the top and never look into the gap.

    `last_outcome` is how the last attempt ended, and it is the field `api/today.py` reads
    to decide what asks for a person. Writing it behind the same guard meant it could only
    ever hold "ok": a failed run following a good one left the earlier "ok" standing, so the
    one screen built to surface a stopped collector never saw one. `updated_at` moving on
    every run fixes the other half of the same thing — a quiet day that collected nothing
    is still a day this collector ran, and freezing the stamp made a working collector read
    as stale.
    """
    from ..db.models import Checkpoint

    checkpoint = session.get(Checkpoint, surface) or Checkpoint(collector_id=surface)
    if run.get("advanced_checkpoint"):
        checkpoint.last_seen_code = run.get("checkpoint")
    checkpoint.last_outcome = str(run.get("outcome") or "ok")
    checkpoint.updated_at = _now()
    session.add(checkpoint)


def _record_raw(
    session: Session,
    run_id: int,
    platform: str,
    platform_item_id: str,
    raw: dict[str, Any],
    report: IngestReport,
) -> None:
    existing = session.scalar(
        select(RawEvent).where(
            RawEvent.run_id == run_id,
            RawEvent.platform == platform,
            RawEvent.platform_item_id == platform_item_id,
        )
    )
    if existing is not None:
        return
    session.add(
        RawEvent(
            run_id=run_id,
            platform=platform,
            platform_item_id=platform_item_id,
            payload=json.dumps(raw, ensure_ascii=False),
            observed_at=_now(),
        )
    )
    report.raw_events += 1


# ---------------------------------------------------------------------- run


def ingest_all(session: Session, capture_dir: Path | None = None) -> IngestReport:
    """Read every capture file present. Absent files are normal, not an error.

    Each file is its own transaction. Reading them all under one commit meant a single
    truncated JSON — a collector killed mid-write is enough — rolled back every file read
    before it. The files stay on disk either way, but a run that reports success while having
    stored nothing is the failure worth preventing.

    A file that raises is recorded in `skipped` and the run continues.
    """
    directory = capture_dir or CAPTURE_DIR
    report = IngestReport()
    if not directory.exists():
        return report

    for surface in SOURCE_SURFACES:
        path = directory / f"{surface}.json"
        if not path.exists():
            continue
        try:
            ingest_source_file(session, path, surface, report)
            session.commit()
        except Exception as error:
            session.rollback()
            report.skipped.append(f"{path.name}: {type(error).__name__}: {error}")

    return report
