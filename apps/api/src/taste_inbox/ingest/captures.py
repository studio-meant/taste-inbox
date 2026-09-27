"""Read what the collectors wrote, and put it in the database.

Three capture shapes arrive here. Instagram Saved produces `CapturedItem` records keyed by
shortcode; Instagram Likes produces `CollectedLike` records keyed the same way; the browser
collectors for GitHub, Threads and LinkedIn produce `SourceItem` records that already carry
a platform and a canonical URL. All three become the same rows — that is the point of
`items` being platform-agnostic.

Ingestion is **idempotent**. Running it twice does not duplicate anything, and it never
overwrites `first_seen_at`: the first time Taste Inbox saw an item is a fact about the
past, and re-reading the same file later must not restate it as today.
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import (
    Evidence,
    Item,
    ItemSource,
    ItemTag,
    MediaAsset,
    RawEvent,
    SourceAccount,
)
from ..paths import REPO_ROOT

CAPTURE_DIR: Path = REPO_ROOT / "var" / "captures"

#: Which Saved collection maps to which Browse domain. The collection name is the user's
#: own classification and travels through unchanged; this is only the file-name mapping.
INSTAGRAM_COLLECTIONS: dict[str, str] = {
    "saved-ai": "ai",
    "saved-music": "music",
    "saved-fashion": "fashion",
}

#: The capture that says which photos a post carried, but not which collection it is in.
#:
#: Instagram stopped serving the named collections on the web on 2026-08-09: the collection
#: list still renders every cover, and every collection opened from it reports "컬렉션에
#: 사진과 동영상을 저장해보세요" while issuing no feed request at all. `모든 게시물` is the
#: one saved surface still answering, and it answers with everything — 342 posts, against
#: the 126 that are filed onto a board.
#:
#: So this file is read for media and nothing else. It cannot say which of `fashion`,
#: `music` or `ai` a post belongs to, and inventing a membership from a feed that does not
#: carry one would put posts on boards the user never filed them under.
INSTAGRAM_MEDIA_ONLY: str = "saved-all-posts"

#: Named here only so a failure to read it can be reported by name.
PROFILE_CAPTURE_NAME = "instagram_profiles.json"

#: The Likes captures, which are the surface that replaced the named collections.
#:
#: `probe collect` stamps each run into the file name — `instagram-collect-20260808T094631Z`
#: — where every other collector overwrites one fixed name. That is a property of the
#: surface and not an accident: a Likes run is *incremental*, it stops at the last-seen
#: checkpoint, and each file therefore holds one slice of a continuous grid rather than a
#: fresh snapshot of the whole thing. Overwriting a fixed name would throw away the slice
#: nobody had ingested yet.
#:
#: So every matching file is read, every run, oldest first. Two consequences worth stating
#: rather than discovering:
#:
#: * **A stale capture cannot duplicate anything.** Identity is `(platform,
#:   platform_item_id)` and `upsert_item` looks the code up before inserting, so re-reading
#:   August's file after September's finds the rows already there and updates them in place.
#:   The unique index behind `items` makes that a property of the schema, not of this loop.
#: * **Oldest first is what keeps `first_seen_at` honest.** It is written once and never
#:   again, so the earliest capture that mentions a post is the one that dates it. Reading
#:   newest-first would date every backfilled post at whenever the most recent run happened.
#:
#: The name is matched exactly rather than by prefix. `var/captures/` also holds
#: `instagram-likes-<stamp>.json` from the response *survey* — a different tool with a
#: different shape (`CapturedItem`: an `owner`, no `permalink`) — plus `-summary` and
#: `-redacted` siblings, and a prefix glob would hand this reader files it cannot parse. The
#: stamp is `%Y%m%dT%H%M%SZ`, which sorts chronologically as text, and that is what makes
#: `sorted()` below mean "oldest first" rather than merely "in some order".
LIKES_CAPTURE_GLOB = "instagram-collect-*.json"
LIKES_CAPTURE_NAME = re.compile(r"^instagram-collect-\d{8}T\d{6}Z\.json$")

#: Historical media repairs are timestamped because each file is a partial set of known
#: items. They use the same restricted ingestion path as `saved-all-posts`: attach media to
#: an existing Instagram row and never create an item, membership, caption, or checkpoint.
MEDIA_REPAIR_CAPTURE_GLOB = "instagram-media-repair-*.json"
MEDIA_REPAIR_CAPTURE_NAME = re.compile(r"^instagram-media-repair-\d{8}T\d{6}Z\.json$")


def likes_captures(directory: Path) -> list[Path]:
    """Every Likes capture in `directory`, oldest first."""
    return sorted(
        path for path in directory.glob(LIKES_CAPTURE_GLOB) if LIKES_CAPTURE_NAME.match(path.name)
    )


def media_repair_captures(directory: Path) -> list[Path]:
    """Every identity-checked historical media repair, oldest first."""
    return sorted(
        path
        for path in directory.glob(MEDIA_REPAIR_CAPTURE_GLOB)
        if MEDIA_REPAIR_CAPTURE_NAME.match(path.name)
    )


#: What the Likes capture records as the user's action, and the only `ACTION_TYPES` member
#: that fits: they liked it. Instagram never says *when*, so `action_at` stays null.
LIKES_ACTION = "like"

#: The scheduled job that collects Likes, and the `checkpoints.collector_id` it keeps.
#:
#: A collector id rather than a capture stem, unlike every key of `BROWSER_SURFACES`. Those
#: two are the same string for the browser surfaces because each writes one fixed file named
#: after itself; a Likes run writes `instagram-collect-<stamp>.json` and the id it reports as
#: is a separate fact. It is in this module because this is where a run is turned into rows —
#: `api/schedule.py` schedules it, `ingest/collect.py` runs it, and all three have to agree
#: on the one string the `checkpoints` row is keyed by.
LIKES_COLLECTOR = "instagram_likes"

#: Browser-collector capture files, and the account each belongs to.
BROWSER_SURFACES: dict[str, tuple[str, str]] = {
    "github_stars": ("github", "star"),
    "threads_reposts": ("threads", "repost"),
    "linkedin_reactions": ("linkedin", "like"),
}

#: The official-API surfaces (2026-09-28), in the same `surface → (platform, action)` shape.
#:
#: Kept as a separate table rather than appended to the one above because the distribution
#: marker gates the two differently — this tree runs these and never those
#: (`distribution.py`). The *documents* they produce are identical, which is why one
#: reader serves both.
#:
#: `huggingface_activity` carries `like` even for the papers it resolves. Nobody upvoted
#: those papers; they arrived because a liked model cites them, and claiming an upvote
#: would invent a signal the user never gave (`api_sources/huggingface/papers.py`).
API_SURFACES: dict[str, tuple[str, str]] = {
    "github_stars_api": ("github", "star"),
    "huggingface_activity": ("huggingface", "like"),
}

#: Every surface whose capture file `ingest_source_file` can read.
SOURCE_SURFACES: dict[str, tuple[str, str]] = {**BROWSER_SURFACES, **API_SURFACES}


@dataclass(slots=True)
class IngestReport:
    """What one ingestion run changed, so a quiet no-op is distinguishable from a failure."""

    files_read: int = 0
    items_new: int = 0
    items_updated: int = 0
    #: Seen again with nothing to change — the normal result of a quiet day.
    items_unchanged: int = 0
    memberships_new: int = 0
    media_recorded: int = 0
    raw_events: int = 0
    #: Posts in a media-only capture that were already on a board, and so could be filled
    #: in. The rest of that capture is saved-but-unfiled and is deliberately not created.
    media_only_matched: int = 0
    media_only_seen: int = 0
    #: Liked posts read out of the timestamped Likes captures, across every file this run.
    #: Counted separately from `items_new` because most of them are re-reads of a slice
    #: already ingested, and a run that reports 40 seen and 0 new is working correctly.
    likes_seen: int = 0
    authors_new: int = 0
    authors_updated: int = 0
    links_recorded: int = 0
    skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "files_read": self.files_read,
            "items_new": self.items_new,
            "items_updated": self.items_updated,
            "items_unchanged": self.items_unchanged,
            "memberships_new": self.memberships_new,
            "media_recorded": self.media_recorded,
            "raw_events": self.raw_events,
            "media_only_matched": self.media_only_matched,
            "media_only_seen": self.media_only_seen,
            "likes_seen": self.likes_seen,
            "authors_new": self.authors_new,
            "authors_updated": self.authors_updated,
            "links_recorded": self.links_recorded,
            "skipped": self.skipped,
        }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _iso_from_unix(seconds: int | None) -> str | None:
    if seconds is None:
        return None
    return datetime.fromtimestamp(seconds, UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalised_stamp(value: object) -> str | None:
    """A collector's timestamp, in the one shape every reader of this database expects.

    `api/today.py::_local_day` refuses anything that is not exactly `YYYY-MM-DDTHH:MM:SSZ`,
    and `_highlights_for` selects a day with a *string* range over `first_seen_at`. Both are
    deliberate (`today.py:65-86`), and both are why the collector's own stamp cannot be
    stored as it arrives: `CollectedLike.first_seen_at` is `datetime.now(UTC).isoformat()`,
    which is `2026-08-08T09:46:31.481907+00:00` — microseconds, and an offset rather than a
    `Z`. Stored verbatim it would be a row Today can neither place on a day nor count.

    An unreadable stamp returns `None` so the caller can fall back to now, rather than
    writing a value the day query will silently skip.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        moment = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if moment.tzinfo is None:
        # Every collector stamps UTC. Reading a bare stamp as machine-local would move the
        # row by however far this machine is from UTC.
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def instagram_permalink(code: str, product_type: str | None) -> str:
    """The permalink form flips on `product_type`, which is why it is not the identity."""
    kind = "reel" if product_type == "clips" else "p"
    return f"https://www.instagram.com/{kind}/{code}/"


def signed_url_expiry(url: str | None) -> str | None:
    """When a signed CDN URL stops working.

    Instagram encodes the expiry as a hex unix timestamp in `oe`. Reading it is what lets
    the media cache know a thumbnail is about to die rather than discovering it later as a
    broken image.
    """
    if not url:
        return None
    raw = parse_qs(urlparse(url).query).get("oe", [None])[0]
    if not raw:
        return None
    try:
        return _iso_from_unix(int(raw, 16))
    except ValueError:
        return None


HASHTAG_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"


def hashtags_of(text: str | None) -> list[str]:
    """Hashtags as written, in order, without duplicates."""
    if not text:
        return []
    found: list[str] = []
    for chunk in text.split("#")[1:]:
        tag = ""
        for character in chunk:
            if character in HASHTAG_CHARS or "가" <= character <= "힣":
                tag += character
            else:
                break
        candidate = f"#{tag}"
        if tag and candidate not in found:
            found.append(candidate)
    return found


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

    `first_seen_at` is written once and never again. It defaults to now because most
    captures overwrite one fixed file and are read the same day they are written, so "when
    this run read it" and "when the collector saw it" are the same instant. The Likes
    captures break that: they accumulate under timestamped names and are re-read for as long
    as they sit in `var/captures/`, so the collector's own observation time is passed in and
    a post first seen in August keeps saying August. Only used on insert — a later capture
    cannot restate when this product first saw something.

    `previous_item_id` is the id a *listing page* used for the same thing, supplied when a
    collector learns a better one. LinkedIn's reactions feed identifies each card by the
    recommendation wrapping the post, and only the post's own page reveals the post's id —
    so the identity of five already-collected rows improved. Without this, the improved
    capture would insert five new rows and strand the originals along with every link,
    resolved shortener and comment artifact attached to them. With it, the row is adopted:
    same `items.id`, so nothing that references it has to move.

    A later capture may be *thinner* than an earlier one without the item having changed:
    `_GITHUB_JS` reports `description: null` whenever a star card renders with fewer than
    two text lines, and both Threads and LinkedIn report `datetime: null` whenever the card
    has no `<time>` element — and those cards demonstrably vary in shape. Overwriting a
    stored description with the null from a thinner render deleted real content on the
    second run.

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
    collection_name: str | None,
    position: int | None,
    report: IngestReport,
    first_seen_at: str | None = None,
    action_at: str | None = None,
) -> None:
    existing = session.scalar(
        select(ItemSource).where(
            ItemSource.item_id == item.id,
            ItemSource.source_account_id == account.id,
            ItemSource.collection_name == collection_name,
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
            collection_name=collection_name,
            position=position,
            first_seen_at=first_seen_at or _now(),
            # Null for the browser surfaces, which never render when the user acted. The
            # official-API collectors do say: GitHub's `starred_at` under the star+json
            # media type, and Hugging Face's `createdAt` on a like.
            action_at=action_at,
        )
    )
    report.memberships_new += 1


#: Hosts whose links name a concrete artifact rather than an article.
ARTIFACT_HOSTS: tuple[str, ...] = ("github.com", "huggingface.co", "arxiv.org")

#: Shorteners that hide what they point at. LinkedIn wraps every external link in one, so
#: a repo link arrives looking like `https://lnkd.in/g6kHemzF` and stays unknown until
#: something follows the redirect — a network call per link, which is Phase 5 enricher
#: work, not ingestion's.
LINK_SHORTENERS: tuple[str, ...] = ("lnkd.in", "bit.ly", "t.co", "buff.ly")


def classify_link(url: str) -> str:
    if any(host in url for host in ARTIFACT_HOSTS):
        return "artifact_link"
    if any(host in url for host in LINK_SHORTENERS):
        return "shortened_link"
    return "outbound_link"


def record_links(session: Session, *, item: Item, urls: list[str], origin: str = "post") -> None:
    """Keep the links a post carried.

    A Threads or LinkedIn post that links a repository is the case that turns a thing to
    read into a thing to run, so the link is the input Phase 5's URL extraction needs.
    Dropping it at ingestion meant that decision could never be made without collecting
    the account again.

    Stored as evidence with `provenance="fact"`: the link was observed, and what lies
    behind a shortener is explicitly not claimed.
    """
    kinds = (
        "artifact_link",
        "shortened_link",
        "outbound_link",
        "comment_artifact_link",
        "comment_shortened_link",
        "comment_outbound_link",
    )
    seen = {
        row.value
        for row in session.scalars(
            select(Evidence).where(Evidence.item_id == item.id, Evidence.type.in_(kinds))
        )
    }
    where = "댓글" if origin == "comment" else "게시물"
    for url in urls:
        if not url or url in seen:
            continue
        seen.add(url)
        kind = classify_link(url)
        session.add(
            Evidence(
                item_id=item.id,
                type=kind if origin == "post" else f"comment_{kind}",
                label={
                    "artifact_link": f"{where}에 포함된 저장소·모델 링크",
                    "shortened_link": f"{where}의 단축 링크 (목적지 미확인)",
                    "outbound_link": f"{where}에 포함된 링크",
                }[kind],
                value=url,
                provenance="fact",
                source_url=item.canonical_url,
                observed_at=_now(),
            )
        )


def record_audio_evidence(session: Session, *, item: Item, raw: dict[str, Any]) -> None:
    """Store the audio track Instagram attached to a Reel.

    An observation, so `provenance="fact"`: this is what the platform said the Reel's
    audio is, not a conclusion about what the Reel recommends. Whether the two coincide is
    an inference the music board makes separately, by checking the caption for the same
    names.

    It lives in `evidence` rather than in a column because that is what the table is for —
    and because 21 of the 41 saved music Reels carry it, which is where every "정확히
    확인됨" on that board comes from. Dropping it made the live board worse than the
    fixture it replaced.
    """
    artist = raw.get("audio_artist")
    title = raw.get("audio_title")
    if not artist and not title:
        return

    value = " - ".join(part for part in (artist, title) if part)
    existing = session.scalar(
        select(Evidence).where(Evidence.item_id == item.id, Evidence.type == "audio_attribution")
    )
    if existing is not None:
        existing.value = value
        return
    session.add(
        Evidence(
            item_id=item.id,
            type="audio_attribution",
            label="릴스 오디오 표기",
            value=value,
            provenance="fact",
            source_url=item.canonical_url,
            observed_at=_now(),
        )
    )


#: Instagram's own description of a post's image, kept as evidence in its own right.
#:
#: `record_media` also keeps this on the cover asset, which is the honest place for it as a
#: *description of a photo* — it becomes that photo's `alt`. This row is the other thing the
#: same string is: an input to the classifier, which never looks at `media_assets` and must
#: still find it independently if a media capture temporarily fails.
#:
#: The two are not redundant and the second is not a leftover. Until 2026-08-12 the Likes
#: collector read no image URLs whatsoever, so evidence was the only home this string had;
#: now that it has both, the evidence row still carries the signal used to choose a board.
#:
#: Keeping it matters and is not a detail: measured over 126 already-filed saves, adding this
#: string to the classifier's input moved 119/126 agreement to 123/126, and every one of the
#: four it rescued was a post whose caption was an emoji or empty.
ACCESSIBILITY_EVIDENCE = "accessibility_caption"


def record_accessibility_caption(session: Session, *, item: Item, alt_text: str | None) -> None:
    """Keep Instagram's auto-generated alt text as evidence.

    `provenance="external"` rather than `fact` or `inference`. It is not this product's
    conclusion, so it is not an inference; and it is not an observation of the world either —
    "May be an image of one person, standing" is Instagram's vision model guessing, and its
    own hedge says so. `external` is exactly the member `EVIDENCE_PROVENANCE` has for
    somebody else's conclusion, and it keeps the UI from ever printing this next to a
    "정확히 확인됨".
    """
    text = (alt_text or "").strip()
    if not text:
        return
    existing = session.scalar(
        select(Evidence).where(Evidence.item_id == item.id, Evidence.type == ACCESSIBILITY_EVIDENCE)
    )
    if existing is not None:
        existing.value = text
        return
    session.add(
        Evidence(
            item_id=item.id,
            type=ACCESSIBILITY_EVIDENCE,
            label="인스타그램이 붙인 대체 텍스트",
            value=text,
            provenance="external",
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
#: saying `auto` versus naming a person is the whole difference between "Official repo" and
#: "Official repo · author-linked", and it is not recoverable from the URL afterwards.
#:
#: `provenance` stays whatever the collector declared, which for these is `huggingface`.
#: It is somebody else's statement, not this product's conclusion — the same reason
#: `record_accessibility_caption` uses `external` for Instagram's alt text.
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
    for row in existing:
        session.delete(row)
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


#: The role the cover has always had, and the value every other reader keys off
#: (`api/cards.py`, `enrich/thumbnails.py`). It stays the cover's.
COVER_ROLE = "thumbnail"


def media_role(position: int) -> str:
    """What to call the photo at `position`, cover first.

    The cover keeps `thumbnail`; the rest are named after the slide they are, 1-based with
    the cover as slide 1 — so a carousel's second photo is `image_02`. Zero-padded because
    the number is read back to order the gallery, and `image_10` must not sort before
    `image_2`.

    `media_assets` is unique on `(item_id, role)`, so a position that names its own role is
    also what makes re-ingesting the same capture update rows instead of adding them.
    """
    return COVER_ROLE if position == 0 else f"image_{position + 1:02d}"


def captured_images(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Every photo one captured item carried, in the order the author posted them.

    `images` comes from `instagram/capture.py`. Captures written before the collector read
    past `carousel_media` carry only the cover, so the thumbnail fields stand in as a
    one-entry list — re-reading yesterday's file must not drop the one image it does have.
    """
    images = raw.get("images")
    if isinstance(images, list) and images:
        return [image for image in images if isinstance(image, dict) and image.get("url")]
    url = raw.get("thumbnail_url")
    if not url:
        return []
    return [
        {"url": url, "width": raw.get("thumbnail_width"), "height": raw.get("thumbnail_height")}
    ]


def record_media(
    session: Session,
    *,
    item: Item,
    images: list[dict[str, Any]],
    alt_text: str | None,
    report: IngestReport,
) -> None:
    """One row per photo, so the card can render the post the way it was posted.

    This used to record a single asset per item, which is why all 126 collected items hold
    exactly one image each. The position is carried in the role rather than in a new
    column, so the order survives a re-read in whatever order the rows come back.

    A photo missing from a later capture is **not** deleted, for the same reason a null
    never overwrites a stored caption (`upsert_item`): a thinner re-render is not a
    deletion, and the media cache already holds bytes those rows point at. A stale extra
    photo is visible and rare; silently erasing a collected one is neither.
    """
    for position, image in enumerate(images):
        remote_url = image.get("url")
        if not remote_url:
            continue
        role = media_role(position)
        existing = session.scalar(
            select(MediaAsset).where(MediaAsset.item_id == item.id, MediaAsset.role == role)
        )
        asset = existing or MediaAsset(item_id=item.id, role=role)
        asset.remote_url = remote_url
        asset.remote_expires_at = signed_url_expiry(remote_url)
        asset.width = image.get("width")
        asset.height = image.get("height")
        # Instagram's accessibility caption describes the post, which is to say its cover.
        # Copying it onto the other photos would claim it describes each of them.
        asset.alt_text = alt_text if position == 0 else None
        if existing is None:
            session.add(asset)
            report.media_recorded += 1
    session.flush()


# ------------------------------------------------------------------ sources


def ingest_instagram_file(
    session: Session, path: Path, collection: str, report: IngestReport
) -> None:
    items = json.loads(path.read_text(encoding="utf-8"))
    account = ensure_account(session, "instagram", None, "Instagram Saved")

    for position, raw in enumerate(items):
        code = str(raw.get("code") or "").strip()
        if not code:
            report.skipped.append(f"{path.name}[{position}]: no code")
            continue

        caption = raw.get("caption") or ""
        item = upsert_item(
            session,
            platform="instagram",
            platform_item_id=code,
            canonical_url=instagram_permalink(code, raw.get("product_type")),
            # An Instagram save is a post, whatever domain it was filed under. Calling it
            # a repo or a product would assert something no enricher has established.
            kind="post",
            title=None,
            body_text=caption or None,
            author=raw.get("owner"),
            source_published_at=_iso_from_unix(raw.get("taken_at")),
            action_at=None,
            report=report,
        )
        set_tags(session, item, hashtags_of(caption))
        record_membership(
            session,
            item=item,
            account=account,
            action_type="save",
            collection_name=collection,
            position=position,
            report=report,
        )
        record_audio_evidence(session, item=item, raw=raw)
        record_media(
            session,
            item=item,
            images=captured_images(raw),
            alt_text=raw.get("accessibility_caption"),
            report=report,
        )
    report.files_read += 1


def _likes_permalink(session: Session, code: str, raw: dict[str, Any]) -> str:
    """The canonical URL for a liked post, without downgrading one already known.

    `instagram_permalink` picks `/reel/` or `/p/` from `product_type`, and the Likes
    collector frequently has no product type to give: when the tile opens an overlay instead
    of navigating, `_detail_from_overlay` builds a `CapturedItem` with `product_type=None`
    and the permalink comes back as `/p/<code>/`. If the same post was already collected
    from a Saved feed that *did* say `clips`, `upsert_item` would overwrite the stored
    `/reel/` URL with the weaker guess — a row losing information by being seen again.

    So a capture that cannot tell keeps whatever the database already decided, and only a
    capture that names a product type is allowed to change it.
    """
    if raw.get("product_type"):
        return instagram_permalink(code, raw.get("product_type"))
    existing = session.scalar(
        select(Item).where(Item.platform == "instagram", Item.platform_item_id == code)
    )
    if existing is not None:
        return existing.canonical_url
    permalink = str(raw.get("permalink") or "").strip()
    return permalink or instagram_permalink(code, None)


def _likes_document(payload: Any) -> tuple[dict[str, Any], list[Any]]:
    """Split a Likes capture into its run and its items, whichever shape it arrived in.

    Two shapes, and both are real files on this machine:

    * `{"run": {…}, "items": [{…}]}` — what `probe collect` writes since the Likes surface
      was put on the schedule. The same envelope `ingest_browser_file` reads, so the run
      reaches `collector_runs` and `checkpoints` through the very same two functions.
    * a bare `[{…}]` — the five captures written on 2026-08-08, before there was a run to
      record. They are the only history this surface has and they still ingest; what they
      cannot do is advance a checkpoint, because nothing in them says whether the run that
      produced them reached the previous one.

    Read as a *shape* rather than from a version field. A version would have to be written
    by the collectors package and understood here, which is a second contract across the one
    seam this design keeps narrow; the presence of `run` says everything a version would.
    """
    if isinstance(payload, dict):
        run = payload.get("run")
        items = payload.get("items")
        return (run if isinstance(run, dict) else {}), (items if isinstance(items, list) else [])
    return {}, payload if isinstance(payload, list) else []


def ingest_likes_file(session: Session, path: Path, report: IngestReport) -> None:
    """Read one Likes capture.

    Instagram's saved *collections* stopped answering on 2026-08-09 (see
    `INSTAGRAM_MEDIA_ONLY` above), so the surface this product now tracks is Likes:
    `your_activity/interactions/likes/`, which is handle-free and has never broken. The
    trade is stated in `docs/DECISIONS.md` and is not hidden here — a Like carries no filing,
    so this writes **`collection_name = NULL`** and an unclassified like appears on no board
    at all until `enrich/classify.py` gives it one. `board_filter` only matches a named
    collection or a routed platform, and Instagram is not a routed platform, so a NULL row is
    invisible rather than misplaced. That is the correct behaviour for "we have not decided
    yet", and it is what makes running the ingester without the classifier safe.

    Two fields are deliberately not written:

    * **`author` stays null.** The Likes grid never names the poster — `CollectedLike` has no
      `owner` — and taking the handle out of Instagram's alt text (`Photo shared by eyesmag
      on …`) would be inventing an attribution out of a string written for screen readers.
    * **`position` stays null.** Every other surface's position is an index into one feed
      read start-to-finish. A Likes capture is a *slice*: the run stops at the last-seen
      checkpoint, so each file restarts at 0 and file-local index 3 means nothing next to
      yesterday's index 3. Null leaves `board_query` ordering these by `first_seen_at`, which
      is the only ordering the surface actually supports.

    **Photos are written, as of 2026-08-12.** They were not until then: `CollectedLike` had
    no image field, so the first four likes to reach the Style board — a photo board — put
    three captions and no pictures on it. `captured_images` reads the same `images` list the
    Saved path reads, `record_media` writes the same rows, and `media.cache_pending` copies
    the bytes down on the same cycle as every other board's. An empty image list is now an
    explicit collector failure: the Likes collector retries the identity-checked permalink
    and reports the shortcode if even that yields no display media.

    The **run** is recorded first, through the same `_record_run` the browser surfaces use.
    That is what puts `instagram_likes` in `checkpoints` — so the next scheduled run knows
    where to stop, `_gate` in `ingest/collect.py` can hold a collector that hit three login
    walls, and `/api/system/collectors` can say this surface exists at all. Before it, the
    Likes checkpoint lived nowhere but a line of terminal output a person had to copy.
    """
    run, items = _likes_document(json.loads(path.read_text(encoding="utf-8")))

    # `_record_run` is keyed on `(collector_id, started_at)`, so a capture that has already
    # been ingested is recognised and does not advance anything a second time. That matters
    # more here than for the fixed-name surfaces: these files accumulate, and every one of
    # them is re-read on every run for as long as it sits in `var/captures/`.
    if run:
        _record_run(session, LIKES_COLLECTOR, run, report)

    account = ensure_account(session, "instagram", None, "Instagram Saved")

    for position, raw in enumerate(items):
        code = str(raw.get("code") or "").strip()
        if not code:
            report.skipped.append(f"{path.name}[{position}]: no code")
            continue

        report.likes_seen += 1
        caption = raw.get("caption") or ""
        # The collector's own observation time, not this run's: these files accumulate and
        # are re-read for months, and `_now()` would re-date every one of them today.
        seen_at = normalised_stamp(raw.get("first_seen_at"))

        item = upsert_item(
            session,
            platform="instagram",
            platform_item_id=code,
            canonical_url=_likes_permalink(session, code, raw),
            # A liked Instagram post is a post. Whatever board it lands on later is a
            # classification, and `kind` is not where classifications live.
            kind="post",
            title=None,
            body_text=caption or None,
            author=None,
            source_published_at=_iso_from_unix(raw.get("taken_at")),
            action_at=None,
            report=report,
            first_seen_at=seen_at,
        )
        if caption:
            # Guarded, unlike the Saved path, because `set_tags` replaces the whole list and
            # this capture can legitimately have no caption at all — the overlay reader
            # returns `""` when Instagram serves only alt text. An empty caption from a
            # thinner surface must not delete the hashtags a richer one already stored, for
            # the same reason `upsert_item` never lets a null overwrite a value.
            set_tags(session, item, hashtags_of(caption))
        record_membership(
            session,
            item=item,
            account=account,
            action_type=LIKES_ACTION,
            collection_name=None,
            position=None,
            report=report,
            first_seen_at=seen_at,
        )
        record_audio_evidence(session, item=item, raw=raw)
        record_accessibility_caption(session, item=item, alt_text=raw.get("accessibility_caption"))
        # The same call the Saved path makes, over the same `images` list, so a liked
        # carousel becomes the same rows a saved one does and `media.cache_pending`
        # downloads them on the very next cycle without knowing which surface they came
        # from. A capture written before the collector read images — and the five bare-list
        # files from 2026-08-08 are exactly that — yields an empty list and records nothing.
        record_media(
            session,
            item=item,
            images=captured_images(raw),
            alt_text=raw.get("accessibility_caption"),
            report=report,
        )
    report.files_read += 1


def ingest_media_only_file(session: Session, path: Path, report: IngestReport) -> None:
    """Fill in the photos of posts already collected, and touch nothing else.

    Deliberately *not* `ingest_instagram_file` with a different collection name. That
    function upserts an item and records a membership, and this capture carries neither
    honestly: `모든 게시물` holds 342 posts with no indication of which collection any of
    them sits in. Running the normal path over it would file 216 posts under a collection
    named after the feed they came from, and hand every existing item a second membership
    it never had.

    A post here that is not already on a board is skipped, not created. That is the whole
    point of the restriction — and it costs nothing, because the boards' 126 items were all
    present in the capture when this was written.

    Captions, tags, authors and audio are left alone too. The named collections are the
    surface those come from, and when Instagram serves them again they will be re-read from
    a feed that knows what it is describing. This one only knows the pixels.
    """
    items = json.loads(path.read_text(encoding="utf-8"))
    report.media_only_seen += len(items)

    for position, raw in enumerate(items):
        code = str(raw.get("code") or "").strip()
        if not code:
            report.skipped.append(f"{path.name}[{position}]: no code")
            continue

        item = session.scalar(
            select(Item).where(Item.platform == "instagram", Item.platform_item_id == code)
        )
        if item is None:
            # Saved, but not filed onto any board this product renders. Nothing to attach
            # photos to, and creating a row would be creating an item out of a feed that
            # cannot say where it belongs.
            continue

        report.media_only_matched += 1
        record_media(
            session,
            item=item,
            images=captured_images(raw),
            alt_text=raw.get("accessibility_caption"),
            report=report,
        )

    report.files_read += 1


def ingest_browser_file(session: Session, path: Path, surface: str, report: IngestReport) -> None:
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
            # Measured: none of these three surfaces renders when the user acted.
            action_at=raw.get("action_at"),
            report=report,
            # What the listing called it, when the collector found a better id on the
            # item's own page. Absent on every surface where the two are the same.
            previous_item_id=(str(raw["list_id"]) if raw.get("list_id") else None),
        )
        set_tags(session, item, raw.get("tags") or [])
        record_links(session, item=item, urls=list(raw.get("outbound_urls") or []))
        # Kept apart from the author's own links: a repository someone recommended in a
        # reply is a different claim from one the poster linked.
        record_links(
            session,
            item=item,
            urls=list(raw.get("comment_urls") or []),
            origin="comment",
        )
        record_membership(
            session,
            item=item,
            account=account,
            action_type=action_type,
            collection_name=None,
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
    (:88 and :243) to decide what asks for a person. Writing it behind the same guard meant
    it could only ever hold "ok", because `browser_sources.py` sets `advanced_checkpoint`
    only when the run was OK *and* found items: a blocked run following a good one left the
    earlier "ok" standing, so the one screen built to surface a stopped collector never saw
    one. `updated_at` moving on every run fixes the other half of the same thing — a quiet
    day that collected nothing is still a day this collector ran, and freezing the stamp
    made a working collector read as stale.
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
    before it, so one bad Threads capture silently discarded a good Instagram one. The
    files stay on disk either way, but a run that reports success while having stored
    nothing is the failure worth preventing.

    A file that raises is recorded in `skipped` and the run continues.
    """
    directory = capture_dir or CAPTURE_DIR
    report = IngestReport()
    if not directory.exists():
        return report

    jobs: list[tuple[Path, str, bool]] = [
        (directory / f"{stem}.json", collection, True)
        for stem, collection in INSTAGRAM_COLLECTIONS.items()
    ] + [(directory / f"{surface}.json", surface, False) for surface in SOURCE_SURFACES]

    # Last, and in its own transaction like the rest. It only ever adds photos to items the
    # files above established, so running it before them would simply find fewer of them.
    media_only = directory / f"{INSTAGRAM_MEDIA_ONLY}.json"

    for path, label, is_instagram in jobs:
        if not path.exists():
            continue
        try:
            if is_instagram:
                ingest_instagram_file(session, path, label, report)
            else:
                ingest_browser_file(session, path, label, report)
            session.commit()
        except Exception as error:
            session.rollback()
            report.skipped.append(f"{path.name}: {type(error).__name__}: {error}")

    # Between the fixed-name captures and the media-only fill-in, and oldest first.
    #
    # Before the fill-in because that file only ever adds photos to items something else
    # established, and a liked post it could match has to exist by then. Oldest first
    # because `first_seen_at` is written once: the earliest capture that mentions a post is
    # the one entitled to date it. Each file is its own transaction like every other, so a
    # truncated capture — a collector killed mid-write leaves one behind — costs that file
    # and not the run.
    for likes in likes_captures(directory):
        try:
            ingest_likes_file(session, likes, report)
            session.commit()
        except Exception as error:
            session.rollback()
            report.skipped.append(f"{likes.name}: {type(error).__name__}: {error}")

    if media_only.exists():
        try:
            ingest_media_only_file(session, media_only, report)
            session.commit()
        except Exception as error:
            session.rollback()
            report.skipped.append(f"{media_only.name}: {type(error).__name__}: {error}")

    # Repairs must be last: the older saved-all-posts capture would otherwise put an
    # expired signed URL straight back over the fresh permalink URL before caching.
    for repair in media_repair_captures(directory):
        try:
            ingest_media_only_file(session, repair, report)
            session.commit()
        except Exception as error:
            session.rollback()
            report.skipped.append(f"{repair.name}: {type(error).__name__}: {error}")

    # Profiles, on the same footing as every other capture. They were read by a one-off
    # script when the feature was built, which left the scheduled run and the Refresh button
    # unable to pick up a re-read profile at all — a shop the account had just added would
    # sit in the capture file indefinitely.
    try:
        from .authors import ingest_profiles

        authors = ingest_profiles(session, directory)
        session.commit()
        report.files_read += authors.files_read
        report.authors_new += authors.authors_new
        report.authors_updated += authors.authors_updated
        report.links_recorded += authors.links_recorded
        report.skipped.extend(authors.skipped)
    except Exception as error:
        session.rollback()
        report.skipped.append(f"{PROFILE_CAPTURE_NAME}: {type(error).__name__}: {error}")

    return report
