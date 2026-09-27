"""Turn database rows into the card models the frontend already renders.

This is the Python mirror of `apps/web/src/lib/mock/mappers.ts`, and it obeys the same
rule: **an unenriched item must not look enriched.** Nothing here fills a gap with a
plausible value. `checkedAt` is null because no enricher has looked, not because a lookup
failed, and a field no producer will ever fill is removed rather than sent as a null.

Field names are camelCase because they cross to TypeScript and are validated there against
the zod schemas in `packages/shared/src/domain/`. A name that disagrees with those schemas
is a runtime error on the other side, which is the intended coupling.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlsplit

from sqlalchemy import Select, and_, exists, func, or_, select, tuple_
from sqlalchemy.orm import Session, aliased

from ..db.models import Author, AuthorLink, Evidence, Item, ItemSource, ItemTag, MediaAsset
from ..ingest.captures import COVER_ROLE

#: Which collection feeds which board.
#:
#: The keys are the product's board names; the values are the names the user typed on
#: Instagram. `trends` reads from a collection they called `ai`, exactly as `style` reads
#: from one they called `fashion` — their word for it is data and is never rewritten.
#: `enrich/classify.py::LABEL_COLLECTIONS` translates the classifier's board names back into
#: these same values for the same reason, and `tests/test_classify.py` pins the two together.
#:
#: `places` is the exception, and its two names match for a different reason than `music`'s
#: do: **no Saved collection on Instagram is called that**, so the value is the product's own
#: word rather than a record of the user's. It was an empty board until 2026-08-12, when the
#: classifier gained the ability to file into it. Adding it needed no migration:
#: `collection_name` is a free `VARCHAR(64)` with no CHECK behind it, and a saved restaurant
#: is an Instagram post, whose `kind` the `items` CHECK already allows.
#:
#: Nothing here matches `none`, which is what `enrich/classify.py` stores when it looked and
#: found no board. That is deliberate: a declined item is on no board, in the same place an
#: undecided one is, reached by decision rather than by omission.
BOARD_COLLECTIONS: dict[str, str] = {
    "trends": "ai",
    "style": "fashion",
    "music": "music",
    "places": "places",
}

#: Platforms whose items go to one board by rule.
#:
#: A rule, not an inference: starring a repository or reacting on LinkedIn says nothing
#: about a topic, so the product is not claiming to have worked anything out. Reading all
#: fifteen collected items, thirteen were about AI tooling and two were UI design — a
#: wrong drawer for those two, never wrong information, since the link and the text stay
#: exactly what was collected.
#:
#: `item_sources.collection_name` stays NULL for these. "The user filed this" and "we
#: routed this by rule" are different facts, and the database records the first while the
#: query applies the second — so a future classifier can change the routing without
#: rewriting history (docs/DECISIONS.md, 2026-08-08).
#:
#: **No platform routes to `places`, and none should.** A GitHub star is never a restaurant
#: and neither is a LinkedIn reaction, so there is no rule to state — which leaves
#: `board_filter("places")` as membership alone, the branch it already had for a board with
#: no routed platform.
PLATFORM_BOARDS: dict[str, str] = {
    "github": "trends",
    "threads": "trends",
    "linkedin": "trends",
}

PLATFORM_LABEL: dict[str, str] = {
    "github": "GitHub",
    "huggingface": "Hugging Face",
    "arxiv": "arXiv",
    "threads": "Threads",
    "linkedin": "LinkedIn",
    "instagram": "Instagram",
    "web": "웹",
}


#: The stored value for items explicitly put on no board, and its presentation name.
#:
#: **Two names for two vocabularies, which this time happen to be the same string.** The
#: first is a board name in the product's own words, the value `/api/none/items` and the
#: frontend's `/none` route speak; the second is what is stored in the column, written by
#: `enrich/classify.py::DECLINED` and now also by `api/boards.py`. They are separate
#: constants for exactly the reason `trends` and `ai` are: if the stored word ever has to
#: change, the URL should not have to.
#:
#: Not a member of `BOARD_COLLECTIONS`, deliberately. That mapping answers which filed board
#: an item occupies; None is the visible no-board inbox. It keeps its own query, count and
#: route, while the frontend includes that result in Browse > All so every collected item
#: Today counts is reachable.
#:
#: `enrich/classify.py` does not import this and must not: an enricher reading the
#: presentation layer is the wrong direction of dependency. `tests/test_classify.py` pins
#: the two strings together, the same way it already pins `LABEL_COLLECTIONS` against
#: `BOARD_COLLECTIONS`.
DECLINED_BOARD = "none"
DECLINED_COLLECTION = "none"


def declined_filter() -> Any:
    """Items something looked at and filed nowhere.

    Membership alone, with no routed-platform branch — and there could not be one. A routed
    platform is a *rule* about where an unclassified item goes, and this shelf is the
    opposite: the record of a decision that was actually taken. A GitHub star nobody has
    ruled on is null, sits on Trends by rule, and is not here.
    """
    return ItemSource.collection_name == DECLINED_COLLECTION


def awaiting_board_filter() -> Any:
    """A collected Instagram Like that is still waiting for a board.

    Instagram is deliberately explicit here. GitHub, Threads and LinkedIn also keep a null
    collection because their board comes from ``PLATFORM_BOARDS``; putting every null row
    on the None shelf would duplicate those items instead of revealing the Likes that were
    genuinely invisible.
    """
    return and_(
        ItemSource.collection_name.is_(None),
        ItemSource.action_type == "like",
        Item.platform == "instagram",
    )


def no_board_query() -> Select[tuple[Item]]:
    """Everything with no visible board: pending Instagram Likes plus explicit None items.

    A post can have both a Saved membership and a later Like membership. The Saved row
    already puts it on a real board, so the null Like must not make the same item appear a
    second time on None or in Browse > All.
    """
    assigned = aliased(ItemSource)
    has_assigned_board = exists(
        select(assigned.id).where(
            assigned.item_id == Item.id,
            assigned.collection_name.in_(tuple(BOARD_COLLECTIONS.values())),
        )
    )
    return (
        select(Item)
        .join(ItemSource, ItemSource.item_id == Item.id)
        .where(
            or_(
                declined_filter(),
                and_(awaiting_board_filter(), ~has_assigned_board),
            )
        )
        .distinct()
        .order_by(Item.first_seen_at.desc(), Item.id)
    )


def count_no_board(session: Session) -> int:
    query = no_board_query().order_by(None).subquery()
    return session.scalar(select(func.count()).select_from(query)) or 0


def board_filter(board: str) -> Any:
    """What belongs on a board: the user's own filing, plus the by-rule platforms.

    Public because `today.py` needs the same rule narrowed to one day, and the alternative
    is a second copy of it — which is exactly how the Today screen came to disagree with
    the boards about which items are on them.
    """
    collection = BOARD_COLLECTIONS[board]
    routed = [platform for platform, target in PLATFORM_BOARDS.items() if target == board]
    membership = ItemSource.collection_name == collection
    if not routed:
        return membership
    return or_(membership, and_(ItemSource.collection_name.is_(None), Item.platform.in_(routed)))


def board_query(board: str) -> Select[tuple[Item]]:
    """Items on one board, in save order."""
    return (
        select(Item)
        .join(ItemSource, ItemSource.item_id == Item.id)
        .where(board_filter(board))
        .order_by(Item.platform, ItemSource.position, Item.first_seen_at.desc())
    )


def count_for_board(session: Session, board: str) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Item)
            .join(ItemSource, ItemSource.item_id == Item.id)
            .where(board_filter(board))
        )
        or 0
    )


def tags_of(session: Session, item: Item) -> list[str]:
    return list(
        session.scalars(
            select(ItemTag.tag).where(ItemTag.item_id == item.id).order_by(ItemTag.ordinal)
        )
    )


def _membership(session: Session, item: Item) -> ItemSource | None:
    return session.scalar(select(ItemSource).where(ItemSource.item_id == item.id))


def _media_order(asset: MediaAsset) -> tuple[int, int]:
    """Which slide an asset is, from the position `ingest/captures.py` wrote into `role`.

    The cover is slide 1. A role nobody recognises sorts last rather than being dropped —
    a stored photo is always worth showing, even if a future writer names it something
    this reader has not heard of.
    """
    if asset.role == COVER_ROLE:
        return (0, 0)
    _, _, number = asset.role.partition("_")
    return (1, int(number)) if number.isdigit() else (2, asset.id)


def _media_assets(session: Session, item: Item) -> list[MediaAsset]:
    """Every photo this item carries, in the order the author posted them.

    Not row order: a re-ingest updates rows in place, but a photo a later capture adds is
    appended, so `id` and slide stop agreeing the moment a post gains an image.
    """
    rows = session.scalars(select(MediaAsset).where(MediaAsset.item_id == item.id)).all()
    return sorted(rows, key=_media_order)


def _cover(session: Session, item: Item) -> MediaAsset | None:
    """The first photo. What every card except Style shows, and all any of them showed."""
    assets = _media_assets(session, item)
    return assets[0] if assets else None


def _media_src(asset: MediaAsset | None) -> str | None:
    """Prefer the cached copy; fall back to the signed URL while it still resolves.

    The local path wins because the remote one expires — verified against the CDN, which
    returns 403 for a URL whose signature has passed.
    """
    if asset is None:
        return None
    if asset.local_path:
        return f"/api/media/{asset.id}"
    return asset.remote_url


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


#: Evidence types that hold a URL the item pointed at.
#:
#: Ordered by how actionable the destination is: a repository or model page is something
#: the Trends board can do something with, a resolved shortener is at least a real page,
#: and a shortener nobody followed is still a working click.
LINK_TYPES: tuple[str, ...] = (
    "artifact_link",
    "comment_artifact_link",
    "outbound_link",
    "comment_outbound_link",
    "shortened_link",
    "comment_shortened_link",
)

#: How the resolver marks a destination it reached by following a shortener.
RESOLVED_PREFIX = "resolved::"


def _host_label(url: str) -> str:
    """The destination's host, without `www.`.

    A host and not a page title: a title would have to be fetched, and nothing about
    rendering a card is allowed to make a request. The host is what tells the user whether
    the click is worth making.
    """
    host = urlsplit(url).netloc.lower()
    trimmed = host[4:] if host.startswith("www.") else host
    return trimmed or url


#: How actionable each kind of destination is. Also the render order.
KIND_ORDER: dict[str, int] = {"artifact": 0, "resolved": 1, "outbound": 2, "unresolved": 3}


def _links(session: Session, item: Item) -> list[dict[str, Any]]:
    """Everywhere else this item points, ready to click.

    Four things this is careful about, three of them found by rendering the real
    collection rather than by reading the code:

    - **A followed shortener appears once, as its destination.** The `lnkd.in` wrapper and
      the page behind it are both stored, and showing both would offer the same click
      twice — once to a page that only redirects. The wrapper survives as `via`.
    - **An unfollowed shortener is still offered.** The resolver failing is not a reason to
      remove a link the user could have clicked.
    - **A URL written twice is described by its best row.** One real post links a page
      *and* a shortener to the same page, so two rows carry one URL. Keeping whichever had
      the lower id made the description depend on insertion order — that post lost its
      `via` purely because the plain link was stored first.
    - **A link back into the item's own platform sorts last.** Four of the collected posts
      link LinkedIn company pages and one links a newsletter-follow button; the card
      already has a link to that platform, so these are lateral moves. Sorted down rather
      than dropped — a working click is never taken away.
    """
    rows = list(
        session.scalars(
            select(Evidence)
            .where(Evidence.item_id == item.id, Evidence.type.in_(LINK_TYPES))
            .order_by(Evidence.id)
        )
    )

    followed = {
        row.label.removeprefix(RESOLVED_PREFIX)
        for row in rows
        if row.label.startswith(RESOLVED_PREFIX)
    }

    best: dict[str, dict[str, Any]] = {}
    for row in rows:
        url = row.value
        resolved_from = (
            row.label.removeprefix(RESOLVED_PREFIX)
            if row.label.startswith(RESOLVED_PREFIX)
            else None
        )
        if "shortened" in row.type:
            if url in followed:
                continue
            kind = "unresolved"
        elif "artifact" in row.type:
            kind = "artifact"
        elif resolved_from is not None:
            kind = "resolved"
        else:
            kind = "outbound"

        candidate = {
            "id": f"{item.id}-link-{row.id}",
            "url": url,
            "label": _host_label(url),
            "kind": kind,
            "origin": "comment" if row.type.startswith("comment_") else "post",
            "via": resolved_from,
        }
        existing = best.get(url)
        if existing is None:
            best[url] = candidate
            continue
        # Same URL, two rows. Keep the most actionable description, and keep the route if
        # either row knew one — neither fact belongs to whichever was stored first.
        if KIND_ORDER[kind] < KIND_ORDER[str(existing["kind"])]:
            candidate["via"] = candidate["via"] or existing["via"]
            best[url] = candidate
        elif existing["via"] is None:
            existing["via"] = resolved_from

    own_host = _host_label(item.canonical_url)
    return sorted(
        best.values(),
        key=lambda link: (link["label"] == own_host, KIND_ORDER[str(link["kind"])]),
    )


#: Key under which a page's authors are cached on the session.
_AUTHOR_INDEX = "taste_inbox.author_index"


def load_authors(session: Session, items: Sequence[Item]) -> None:
    """Read every author these items share, once, before any card is built.

    Unlike the other helpers, this one does not belong per card. An author answers for all
    of their posts — measured, the Style board's 76 items come from 61 accounts, and one
    account accounts for five of them — so a lookup inside `to_style_card` would re-read
    the same profile five times and cost 76 queries for 61 rows. Two queries here cost the
    same whether the board holds twenty items or two thousand.

    Calling it is optional. A card built without it still finds its author (the detail view
    has one item and no page to batch), and the index is scoped to this session, so it
    lives exactly as long as the request that built it.
    """
    index: dict[tuple[str, str], dict[str, Any] | None] = session.info.setdefault(_AUTHOR_INDEX, {})
    # Additive, never a replacement. A card whose author was not in the batch loads itself
    # into the same index; overwriting it here would make every card after that one report
    # no author at all.
    wanted = {(item.platform, item.author) for item in items if item.author} - set(index)
    if not wanted:
        return
    # A key present and null means "looked for, not there" — distinct from "never looked",
    # which is what keeps a miss from being re-queried once per card.
    index.update(dict.fromkeys(wanted))

    authors = list(
        session.scalars(
            select(Author).where(
                tuple_(Author.platform, Author.handle).in_(sorted(wanted)),
            )
        )
    )
    if not authors:
        return

    links: dict[int, list[AuthorLink]] = {}
    for row in session.scalars(
        select(AuthorLink)
        .where(AuthorLink.author_id.in_([author.id for author in authors]))
        .order_by(AuthorLink.ordinal)
    ):
        links.setdefault(row.author_id, []).append(row)

    for author in authors:
        index[(author.platform, author.handle)] = {
            "author": author,
            "links": links.get(author.id, []),
        }


def _author_ref(session: Session, item: Item) -> dict[str, Any] | None:
    """Who posted it, and where they sell. Null until the profile has been read.

    The links are the point. Measured across the Style board's 76 posts, almost none carry
    a link of their own while 51 of the 61 authors publish one — the shop lives in the
    profile, so that is where the board's purchase route comes from
    (docs/DECISIONS.md, 2026-08-09).
    """
    if item.author is None:
        return None

    key = (item.platform, item.author)
    index = session.info.get(_AUTHOR_INDEX)
    if index is None or key not in index:
        # Not in the batch — a detail view, or an item the page did not preload. Read this
        # one author rather than the whole board's worth.
        load_authors(session, [item])
        index = session.info[_AUTHOR_INDEX]

    found = index.get(key)
    if found is None:
        return None
    author: Author = found["author"]
    rows: list[AuthorLink] = found["links"]

    return {
        "handle": author.handle,
        "displayName": author.display_name,
        "links": [
            {
                "id": f"{item.id}-shop-{row.id}",
                "url": row.value,
                # The account's own title when it gave one, because it says more than a
                # host: `국내 판매처` and `international shipping` are two storefronts for
                # one brand, and `cwithc.co.kr` distinguishes neither.
                "label": row.title or _host_label(row.value),
                "kind": "shop",
                "origin": "profile",
                "via": None,
            }
            for row in rows
            if row.kind == "link"
        ],
        "mentions": [row.value for row in rows if row.kind == "mention"],
        "checkedAt": author.checked_at,
    }


def _headline(item: Item, fallback: str) -> str:
    """The first line worth showing, or an honest placeholder.

    Never a fabricated title: `title` is null for every Instagram post, so the caption's
    lead line stands in and the card styles it as body text rather than as a name.
    """
    if item.title:
        return item.title
    for line in (item.body_text or "").split("\n"):
        candidate = line.strip()
        if candidate and not candidate.startswith("#"):
            return candidate[:80]
    return fallback


def to_ai_card(session: Session, item: Item) -> dict[str, Any]:
    asset = _cover(session, item)
    src = _media_src(asset)
    return {
        "id": item.id,
        # An Instagram save is a post, and the collected `kind` for everything else.
        "kind": "post" if item.platform == "instagram" else item.kind,
        "title": _headline(item, "저장한 게시물"),
        # The whole post, not a slice of it.
        #
        # This used to cut at 400 characters, which silently discarded most of every long
        # LinkedIn post — the collected five run to 455, 1263, 1878, 2390 and 2678
        # characters, so four of them lost the majority of their text before the card ever
        # saw it. Shortening for display is the card's job and it already clamps; doing it
        # here meant the text was gone by the time anyone could choose to expand it.
        "summary": (item.body_text or "") or "본문이 없습니다.",
        "checkedAt": item.checked_at,
        "tags": tags_of(session, item),
        # The repository or paper a Threads/LinkedIn post is actually about. Without it the
        # only click on this board is to the post that merely mentioned it.
        "links": _links(session, item),
        "source": _source_ref(session, item, f"{PLATFORM_LABEL.get(item.platform, item.platform)}"),
        "preview": None
        if src is None
        else {
            "id": f"{item.id}-cover",
            "type": "video_frame",
            "src": src,
            "width": asset.width if asset else None,
            "height": asset.height if asset else None,
            "alt": (asset.alt_text if asset and asset.alt_text else "저장한 게시물의 표지 이미지"),
        },
    }


def _photo_alt(asset: MediaAsset, position: int) -> str:
    """Instagram's own description when it supplied one; otherwise what the photo *is*.

    Never a description of an image nothing has looked at. The position is a fact, and it
    is also what lets a screen-reader user follow a gallery of five photos.
    """
    if asset.alt_text:
        return asset.alt_text
    if position == 0:
        return "저장한 게시물의 표지 이미지"
    return f"저장한 게시물의 {position + 1}번째 사진"


def _photos(session: Session, item: Item) -> list[dict[str, Any]]:
    """Every photo the post contained, in the order the author posted them.

    One entry for a single image or a Reel, so the gallery has no carousel case.
    """
    photos: list[dict[str, Any]] = []
    # A Reel's cover is a frame lifted from the video; every other stored photo is a
    # photograph. The permalink is what records which, since `product_type` is not a column.
    kind = "video_frame" if "/reel/" in item.canonical_url else "image"
    for position, asset in enumerate(_media_assets(session, item)):
        src = _media_src(asset)
        if src is None:
            continue
        photos.append(
            {
                "id": f"{item.id}-{asset.role}",
                "type": kind,
                "src": src,
                "width": asset.width,
                "height": asset.height,
                "alt": _photo_alt(asset, position),
            }
        )
    return photos


def to_style_card(session: Session, item: Item) -> dict[str, Any]:
    """One saved fashion post: every photo it contained, its caption, and where it points.

    **Nothing resolves a product on this board, and nothing will.** `brand`, `productName`,
    `matchGrade`, `currentPrice`, `observedPrice`, `retailerCount` and `stockState` are
    gone — the same removal, for the same reason, as the AI card's execution fields
    (docs/DECISIONS.md, 2026-08-09). Every one of them was a hardcoded null or "unknown"
    for all 76 items, with no producer that would ever have filled it honestly.

    They are removed rather than left null on purpose. A nullable `brand` still shapes the
    card: it reserves a row, keeps a filter axis in the URL, and tells the next reader that
    an answer is coming. None is. What the board holds is a collected post — its photos,
    its caption, its hashtags and where it points — and the model now says exactly that.
    """
    return {
        "id": item.id,
        # A short name for the card, not a claim about the outfit: the caption's lead line.
        "descriptor": _headline(item, "저장한 패션 게시물"),
        # The post's text, whole. Shortening is the card's job, and the card can undo it.
        "caption": item.body_text or "",
        "checkedAt": item.checked_at,
        "tags": tags_of(session, item),
        "links": _links(session, item),
        # Where the board's purchase route actually comes from: the poster's own profile.
        "author": _author_ref(session, item),
        "source": _source_ref(session, item, "Instagram Saved · Fashion"),
        "media": _photos(session, item),
    }


def to_music_card(session: Session, item: Item) -> dict[str, Any]:
    asset = _cover(session, item)
    src = _media_src(asset)
    cover_text, cover_checked_at = _cover_read(session, item)
    return {
        "id": item.id,
        "source": _source_ref(session, item, "Instagram Saved · Music"),
        "collectionName": "music",
        "caption": item.body_text or "",
        "media": None
        if src is None
        else {
            "id": f"{item.id}-cover",
            "type": "video_frame",
            "src": src,
            "width": asset.width if asset else None,
            "height": asset.height if asset else None,
            "alt": (asset.alt_text if asset and asset.alt_text else "저장한 릴스의 표지 이미지"),
        },
        "candidates": _music_candidates(session, item),
        # Everything the recogniser read off the cover, whether or not any of it looked
        # like a track. On the eight covers that are pure photograph this stays null and
        # the card says so, which is different from never having looked.
        "coverText": cover_text,
        "coverCheckedAt": cover_checked_at,
        "links": _links(session, item),
        "handledAt": None,
    }


def _cover_read(session: Session, item: Item) -> tuple[str | None, str | None]:
    """`(text, when it was read)`.

    Both null means nothing has looked. A null text with a timestamp means something looked
    and the cover is a photograph — eight of the twenty unattributed Reels are exactly that,
    and saying so is more useful than the same silence as "not yet read".
    """
    row = session.scalar(
        select(Evidence).where(Evidence.item_id == item.id, Evidence.type == "thumbnail_text")
    )
    if row is None:
        return None, None
    return (row.value or None) if row.value.strip() else None, row.observed_at


def _normalize_for_match(value: str) -> str:
    return "".join(
        character for character in value.lower() if character.isalnum() or "가" <= character <= "힣"
    )


def _corroborated(item: Item, raw_text: str) -> bool:
    """Does the Reel itself name the track Instagram attached to it?

    Two independent statements of the same artist or title — the platform's attribution
    and the account's own caption or handle — is what separates `exact` from `likely`
    (docs/DECISIONS.md, 2026-08-08). Attribution alone stays `likely`, because on some
    Reels the attached audio is background music rather than the recommendation.
    """
    haystack = _normalize_for_match(f"{item.body_text or ''} {item.author or ''}")
    parts: list[str] = []
    for chunk in raw_text.replace("/", ",").replace("&", ",").split(","):
        parts.extend(chunk.split(" - "))
    return any(
        len(needle) >= 3 and needle in haystack
        for needle in (_normalize_for_match(part) for part in parts)
    )


def _music_candidates(session: Session, item: Item) -> list[dict[str, Any]]:
    """Every track this Reel can be shown to reference, from three readings.

    Instagram's audio attribution first, because it is a string the platform itself
    published. When that is absent, explicit track-shaped statements in the caption come
    next, before anything read from the cover: caption text is a fact while OCR is an
    inference. The caption parser accepts only measured forms (artist + quoted title, a
    middle-dot credit, a spaced dash, a marked song list, and ``'곡' is out now``). Generic
    praise and lyric fragments remain empty rather than being turned into plausible songs.
    """
    attributed = _attribution_candidates(session, item)
    covered = _cover_candidates(session, item)
    if attributed:
        return attributed + covered

    captioned = _caption_candidates(item)
    caption_keys = {_normalize_for_match(str(candidate["rawText"])) for candidate in captioned}
    return captioned + [
        candidate
        for candidate in covered
        if _normalize_for_match(str(candidate["rawText"])) not in caption_keys
    ]


@dataclass(frozen=True, slots=True)
class _CaptionTrack:
    """One conservative parse of text the post's author actually wrote."""

    raw_text: str
    artist: str | None
    title: str | None
    match_grade: str


_QUOTED_BY_ARTIST = re.compile(
    r"(?P<artist>[0-9A-Za-z가-힣][0-9A-Za-z가-힣 .&+_-]{0,79}?)"
    r"\s*의\s*[\u2018\u201c'\"](?P<title>[^\u2019\u201d'\"\n]{1,100})[\u2019\u201d'\"]"
)
_MIDDLE_DOT_CREDIT = re.compile(r"·\s*(?P<artist>[^·\n]{1,60}?)\s*·\s*(?P<title>[^·\n]{1,80}?)\s*·")
_QUOTED_RELEASE = re.compile(
    r"[\u2018\u201c'\"](?P<title>[^\u2019\u201d'\"\n]{1,100})"
    r"[\u2019\u201d'\"]\s+is\s+out\s+now\b",
    re.I,
)
_KOREAN_TITLE_ONLY = re.compile(
    r"(?:데뷔곡|신곡|새\s*싱글|수록곡(?:인)?|타이틀곡(?:인)?)\s*"
    r"[\u2018\u201c'\"](?P<title>[^\u2019\u201d'\"\n]{1,100})[\u2019\u201d'\"]"
)
_ROLE_QUOTED_TITLE = re.compile(
    r"(?:가수|그룹|듀오|밴드|싱어송라이터|아티스트|프로듀서)\s+"
    r"(?P<artist>(?:[A-Z][A-Za-z0-9.-]*|[가-힣]{2,})"
    r"(?:\s+(?:[A-Z][A-Za-z0-9.-]*|[가-힣]{2,})){0,2})\s+"
    r"[\u2018\u201c'\"](?P<title>[^\u2019\u201d'\"\n]{1,100})"
    r"[\u2019\u201d'\"](?=은|는|이|가|\s|[,.])"
)
_DASH_TRACK = re.compile(
    r"^(?:[^0-9A-Za-z가-힣@\[]*)(?:\[[^\]]{1,40}\]\s*)?"
    r"(?P<left>[0-9A-Za-z가-힣@][^-\n]{0,79}?)\s+-\s+"
    r"(?P<right><[^>\n]{1,100}>|[^#\n]{1,100})$"
)
_TITLE_CASE_CREDIT = re.compile(
    r"^(?P<artist>[A-Z0-9]{2,10})\s+"
    r"(?P<title>[A-Z][A-Za-z'\u2019-]*"
    r"(?:\s+(?:a|an|the|of|than|and|to|in|[A-Z][A-Za-z'\u2019-]*)){1,7})$"
)
_ARTIST_ROLE_WORDS = {
    "가수",
    "그룹",
    "듀오",
    "밴드",
    "싱어송라이터",
    "아티스트",
    "프로듀서",
}


def _clean_caption_part(value: str) -> str:
    """Trim display punctuation without rewriting the observed words."""
    return (
        value.strip().strip("<>\u2018\u2019\u201c\u201d'\"").strip().rstrip(".,:;!…·🎧💌").strip()
    )


def _caption_tracks(caption: str) -> list[_CaptionTrack]:
    """Read only explicit, measured track forms from an Instagram caption.

    This is intentionally not a named-entity recogniser. The real unmatched captions also
    contain lyric fragments (``act like a boy 이 부분 너무 좋다``), generic recs, album
    names and people being praised. Returning those as songs would make the hand-off less
    trustworthy than leaving the card empty.
    """
    if not caption.strip():
        return []

    found: list[tuple[int, _CaptionTrack, bool]] = []

    def add(
        position: int,
        *,
        raw_text: str,
        artist: str | None,
        title: str | None,
        grade: str,
        list_item: bool = False,
    ) -> None:
        raw = _clean_caption_part(raw_text)
        clean_artist = _clean_caption_part(artist) if artist else None
        clean_title = _clean_caption_part(title) if title else None
        if not raw or (clean_artist is None and clean_title is None):
            return
        found.append((position, _CaptionTrack(raw, clean_artist, clean_title, grade), list_item))

    # All measured editorial forms occur near the lead. Bounding the prose keeps later
    # examples and "other tracks on the album" from becoming a list the post did not make.
    lead = caption[:700]
    for match in _QUOTED_BY_ARTIST.finditer(lead):
        artist = match.group("artist").strip()
        artist = re.split(r"(?<!feat)\.\s+|[!?]\s+", artist, flags=re.I)[-1]
        words = artist.split()
        if words and words[0] in {"저는", "우리는", "오늘은", "이번엔"}:
            words.pop(0)
        for role in _ARTIST_ROLE_WORDS:
            if role in words:
                words = words[words.index(role) + 1 :]
        artist = " ".join(words)
        if not artist or len(words) > 7:
            continue
        add(
            match.start(),
            raw_text=f"{artist} - {match.group('title')}",
            artist=artist,
            title=match.group("title"),
            grade="likely",
        )

    for match in _MIDDLE_DOT_CREDIT.finditer(lead[:350]):
        artist = _clean_caption_part(match.group("artist"))
        title = _clean_caption_part(match.group("title"))
        add(
            match.start(),
            raw_text=f"{artist} - {title}",
            artist=artist,
            title=title,
            grade="likely",
        )

    for match in _ROLE_QUOTED_TITLE.finditer(lead):
        artist = match.group("artist")
        add(
            match.start(),
            raw_text=f"{artist} - {match.group('title')}",
            artist=artist,
            title=match.group("title"),
            grade="likely",
        )

    # A dash is accepted only when it occupies a whole short line. That is the measured
    # difference between an actual credit and a hyphen inside prose.
    offset = 0
    lines = caption.splitlines()
    for line in lines:
        stripped = line.strip()
        dash_match = _DASH_TRACK.fullmatch(stripped) if len(stripped) <= 180 else None
        if dash_match is not None:
            left = _clean_caption_part(dash_match.group("left"))
            right = _clean_caption_part(dash_match.group("right"))
            if right.startswith("@"):
                artist, title = right.removeprefix("@"), left
            else:
                artist, title = left, right
            add(
                offset + dash_match.start(),
                raw_text=f"{left} - {right}",
                artist=artist,
                title=title,
                grade="likely",
                list_item=True,
            )
        elif len(lines) == 1:
            # One measured caption has no separator at all: ``JM Less Than a Lover``.
            # Accept only an all-caps short artist followed by a title-cased English
            # phrase. That shape excludes the generic Korean praise and lyric fragments
            # that make up the remaining empty captions.
            credit = _TITLE_CASE_CREDIT.fullmatch(stripped)
            if credit is not None:
                artist = credit.group("artist")
                title = credit.group("title")
                add(
                    offset,
                    raw_text=f"{artist} - {title}",
                    artist=artist,
                    title=title,
                    grade="likely",
                )
        offset += len(line) + 1

    for match in _QUOTED_RELEASE.finditer(lead[:300]):
        title = match.group("title")
        add(match.start(), raw_text=title, artist=None, title=title, grade="unknown")

    for match in _KOREAN_TITLE_ONLY.finditer(lead):
        title = match.group("title")
        add(match.start(), raw_text=title, artist=None, title=title, grade="unknown")

    unique: list[tuple[_CaptionTrack, bool]] = []
    keys: set[str] = set()
    for _, track, list_item in sorted(found, key=lambda entry: entry[0]):
        # Prefer a richer artist/title parse when another pattern found the same title.
        key = _normalize_for_match(track.title or track.raw_text)
        if not key or key in keys:
            continue
        keys.add(key)
        unique.append((track, list_item))

    # Multiple candidates are trustworthy only when the caption presented them as
    # separate credit lines. Prose often mentions other songs for comparison or album
    # context; the first explicit credit is the post's subject, the rest are not a list.
    listed = [track for track, list_item in unique if list_item]
    if len(listed) > 1:
        return listed[:8]
    return [unique[0][0]] if unique else []


def _caption_candidates(item: Item) -> list[dict[str, Any]]:
    """Turn explicit caption credits into searchable candidates without a network lookup."""
    candidates: list[dict[str, Any]] = []
    for ordinal, track in enumerate(_caption_tracks(item.body_text or ""), start=1):
        candidates.append(
            {
                "id": f"{item.id}-caption-{ordinal}",
                "rawText": track.raw_text,
                "origin": "caption",
                "ordinal": ordinal,
                "artist": track.artist,
                "title": track.title,
                "album": None,
                "matchGrade": track.match_grade,
                "confidence": None,
                "evidence": [
                    {
                        "id": f"{item.id}-caption-evidence-{ordinal}",
                        "type": "caption_track",
                        "label": "본문에 적힌 곡",
                        "value": track.raw_text,
                        "provenance": "fact",
                        "sourceUrl": item.canonical_url,
                        "observedAt": item.updated_at,
                        "confidence": None,
                    }
                ],
                "searchUrl": f"https://music.youtube.com/search?q={quote(track.raw_text)}",
                "service": "youtube_music",
                "handledAt": None,
                "checkedAt": None,
            }
        )
    return candidates


def _cover_candidates(session: Session, item: Item) -> list[dict[str, Any]]:
    """Track-shaped lines the recogniser read off the cover.

    Always `similar`, never higher, and `artist`/`title` stay null. Two measured reasons:
    the recogniser misreads (`Lullaby / JayDon, Paradise` came back as
    `ullaby / Jay pon, Paraoise`), and the halves of a line have no fixed order —
    `Myles Lloyd - Drive Me Crazy` is artist first while `i kept the light on- Don kai` is
    title first, both from this same collection. So the line is handed over verbatim as a
    search, which is a hand-off the user finishes and cannot save the wrong song.
    """
    rows = list(
        session.scalars(
            select(Evidence)
            .where(Evidence.item_id == item.id, Evidence.type == "thumbnail_track")
            .order_by(Evidence.id)
        )
    )

    candidates: list[dict[str, Any]] = []
    for ordinal, row in enumerate(rows, start=1):
        raw_text = row.value
        candidates.append(
            {
                "id": f"{item.id}-cover-{row.id}",
                "rawText": raw_text,
                "origin": "on_screen_text",
                "ordinal": ordinal,
                # Never split. Which half is the artist is not determinable from the line.
                "artist": None,
                "title": None,
                "album": None,
                "matchGrade": "similar",
                "confidence": row.confidence,
                "evidence": [
                    {
                        "id": f"{item.id}-cover-evidence-{row.id}",
                        "type": "thumbnail_track",
                        "label": row.label,
                        "value": raw_text,
                        # A reading of an image, not the text on it. Those differ.
                        "provenance": "inference",
                        "sourceUrl": item.canonical_url,
                        "observedAt": row.observed_at,
                        "confidence": row.confidence,
                    }
                ],
                "searchUrl": f"https://music.youtube.com/search?q={quote(raw_text)}",
                "service": "youtube_music",
                "handledAt": None,
                "checkedAt": row.observed_at,
            }
        )
    return candidates


def _attribution_candidates(session: Session, item: Item) -> list[dict[str, Any]]:
    """One candidate per audio attribution the collector observed."""
    attribution = session.scalar(
        select(Evidence).where(Evidence.item_id == item.id, Evidence.type == "audio_attribution")
    )
    if attribution is None:
        return []

    raw_text = attribution.value
    corroborated = _corroborated(item, raw_text)
    artist, _, title = raw_text.partition(" - ")
    evidence = [
        {
            "id": f"{item.id}-audio-evidence",
            "type": "audio_attribution",
            "label": attribution.label,
            "value": raw_text,
            "provenance": "fact",
            "sourceUrl": item.canonical_url,
            "observedAt": attribution.observed_at,
            "confidence": None,
        }
    ]
    if corroborated:
        evidence.append(
            {
                "id": f"{item.id}-caption-evidence",
                "type": "caption_mention",
                "label": "게시물이 같은 곡을 언급함",
                "value": raw_text,
                "provenance": "fact",
                "sourceUrl": item.canonical_url,
                "observedAt": attribution.observed_at,
                "confidence": None,
            }
        )

    return [
        {
            "id": f"{item.id}-audio",
            "rawText": raw_text,
            "origin": "platform_audio",
            "ordinal": None,
            "artist": artist or None,
            "title": title or None,
            "album": None,
            "matchGrade": "exact" if corroborated else "likely",
            "confidence": None,
            "evidence": evidence,
            "searchUrl": f"https://music.youtube.com/search?q={quote(raw_text)}",
            "service": "youtube_music",
            "handledAt": None,
            "checkedAt": None,
        }
    ]


def generated_at() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


#: Evidence rows that are already rendered as something else on the detail page, so showing
#: them again in the observation list would be the same fact twice.
#:
#: The link rows are the whole of it: `_links` turns them into clickable chips, which is a
#: better presentation of a URL than a row in a table.
EVIDENCE_SHOWN_ELSEWHERE: frozenset[str] = frozenset(LINK_TYPES)


def board_of(session: Session, item: Item) -> str | None:
    """Which board this item is filed under, for the link back.

    Asked of the same rules the boards themselves use rather than recomputed, so an item
    can never appear on a board that its detail page then denies.

    A pending Instagram Like is presented on None until the classifier gives it a board.
    Its database value stays null, so the classifier can still distinguish "waiting" from
    an explicit `none` decision and resume without a migration.
    """
    for board in BOARD_COLLECTIONS:
        found = session.scalar(
            select(Item.id)
            .join(ItemSource, ItemSource.item_id == Item.id)
            .where(Item.id == item.id, board_filter(board))
        )
        if found is not None:
            return board
    declined = session.scalar(
        select(ItemSource.id).where(ItemSource.item_id == item.id, declined_filter())
    )
    if declined is not None:
        return DECLINED_BOARD
    awaiting = session.scalar(
        select(ItemSource.id)
        .join(Item, Item.id == ItemSource.item_id)
        .where(ItemSource.item_id == item.id, awaiting_board_filter())
    )
    return DECLINED_BOARD if awaiting is not None else None


def _all_evidence(session: Session, item: Item) -> list[dict[str, Any]]:
    """Every observation attached to this item, grouped by kind.

    Ordered by type then id so the page reads as groups rather than as insertion order —
    a Reel with three cover tracks and one audio attribution should not interleave them
    because of when each row happened to be written.
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
    """One item, whole, whichever board it belongs to.

    Not `to_ai_card`. That is the Trends board's *view* of an item, and serving it for every
    item answered for a saved Reel as though it were a repository — the detail route did
    exactly that, and Today links to items from all three boards.
    """
    board = board_of(session, item)
    label = {
        "trends": "Trends",
        "style": "Instagram Saved · Fashion",
        "music": "Instagram Saved · Music",
        # Not "Instagram Saved · Places". The other two name a collection the user actually
        # created; nothing on Instagram is filed under Places, so claiming it would invent a
        # collection. The board's own name is the honest label, as it is for Trends.
        "places": "Places",
        # No entry for `none`, on purpose. This label says where the item came *from*, and a
        # declined item came from Instagram exactly like every other one — so it falls
        # through to the platform. "None" here would answer the wrong question, and the
        # board is already stated separately in the payload.
    }.get(board or "", PLATFORM_LABEL.get(item.platform, item.platform))
    # Every photo, not the cover. The Style board went plural on 2026-08-09 and this route
    # is where someone lands *from* that board — showing one of five here is the surprise
    # they hit the moment the feature works.
    photos = _photos(session, item)

    return {
        "id": item.id,
        "kind": "post" if item.platform == "instagram" else item.kind,
        "board": board,
        "title": _headline(item, "저장한 항목"),
        # Whole. This is the screen someone opens *because* the card was too short.
        "body": item.body_text or "",
        "source": _source_ref(session, item, label),
        "media": photos[0] if photos else None,
        "photos": photos,
        "tags": tags_of(session, item),
        "links": _links(session, item),
        "author": _author_ref(session, item),
        "evidence": _all_evidence(session, item),
        "sourcePublishedAt": item.source_published_at,
        "checkedAt": item.checked_at,
        "firstSeenAt": item.first_seen_at,
    }
