"""Read profile captures into `authors`, so a card can show where to buy.

Separate from `captures.py` because an author is a different grain. A post is collected
once and never changes hands; a profile belongs to an account, is read once, and answers
for every post that account has ever appeared in. Measured on the Style board: 76 posts,
61 accounts.

Idempotent in the same way ingestion is: re-reading the same capture updates the row rather
than adding one, and a later, thinner read never blanks a value an earlier one found. The
reason is the same as in `upsert_item` — a profile page that failed to render its bio must
not be allowed to erase a bio that was read successfully yesterday.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Author, AuthorLink

#: What a capture file for this looks like, so the collector and the reader agree.
PROFILE_CAPTURE = "instagram_profiles.json"


def _absolute(url: str) -> str:
    """A link the browser will treat as a destination rather than as a path.

    A bio writes its shop the way a person says it — `cwithc.co.kr`, `fairyn.kr` — and the
    parser now keeps those, which is the fix that took the board from 28 accounts with a
    link to 51. But a schemeless string in an `href` is a *relative* URL: rendered on the
    card, `applink.a-bly.com/…` navigated to `localhost:4173/applink.a-bly.com/…`.

    This is the gate into the database rather than a step in the collector because it has
    to hold for captures already written, and because the schema on the other side declares
    these as URLs — one schemeless row rejected the whole Style board payload and the
    screen never rendered at all.
    """
    return url if "//" in url.split("?", 1)[0] else f"https://{url}"


def _destination(url: str) -> str:
    """What two spellings of one place have in common, for deduplication.

    Deliberately duplicated from the collector's own `_destination`: this package cannot
    import from `services/collectors`, and the database must not depend on the collector
    having been right. Measured on `@feb.note`, whose shop arrived twice — once as
    `https://applink.a-bly.com/팹노트-ig` from the anchor and once as the same path
    percent-escaped and schemeless from the bio prose.
    """
    parsed = urlparse(_absolute(url))
    host = (parsed.netloc or "").lower()
    trimmed = host.removeprefix("www.")
    return f"{trimmed}{unquote(parsed.path).rstrip('/')}"


@dataclass(slots=True)
class AuthorReport:
    files_read: int = 0
    authors_new: int = 0
    authors_updated: int = 0
    #: Read again with nothing to change.
    authors_unchanged: int = 0
    links_recorded: int = 0
    skipped: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "files_read": self.files_read,
            "authors_new": self.authors_new,
            "authors_updated": self.authors_updated,
            "authors_unchanged": self.authors_unchanged,
            "links_recorded": self.links_recorded,
            "skipped": self.skipped[:10],
        }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def upsert_author(
    session: Session,
    *,
    platform: str,
    handle: str,
    display_name: str | None,
    biography: str | None,
    links: list[dict[str, Any]],
    mentions: list[str],
    report: AuthorReport,
) -> Author:
    """Insert or refresh one account, keyed on `(platform, handle)`."""

    def prefer(new: str | None, old: str | None) -> str | None:
        return new if new is not None else old

    stamp = _now()
    author = session.scalar(
        select(Author).where(Author.platform == platform, Author.handle == handle)
    )
    if author is None:
        author = Author(
            platform=platform,
            handle=handle,
            display_name=display_name,
            biography=biography,
            checked_at=stamp,
            updated_at=stamp,
        )
        session.add(author)
        session.flush()
        report.authors_new += 1
    else:
        merged_name = prefer(display_name, author.display_name)
        merged_bio = prefer(biography, author.biography)
        changed = author.display_name != merged_name or author.biography != merged_bio
        author.display_name = merged_name
        author.biography = merged_bio
        # `checked_at` moves on every read: it records that somebody looked, which is true
        # even when the answer was identical.
        author.checked_at = stamp
        if changed:
            author.updated_at = stamp
            report.authors_updated += 1
        else:
            report.authors_unchanged += 1

    _record_links(session, author, links, mentions, report)
    return author


def _record_links(
    session: Session,
    author: Author,
    links: list[dict[str, Any]],
    mentions: list[str],
    report: AuthorReport,
) -> None:
    """Replace this author's links with what the profile says now.

    Replaced rather than merged, because a bio's link list is a statement about the
    present: a shop the account has taken down should stop being offered. That is the
    opposite of the never-blank rule above, and deliberately so — a missing *value* is
    usually a failed read, while a link removed from a list somebody maintains is a
    decision.
    """
    session.query(AuthorLink).filter(AuthorLink.author_id == author.id).delete(
        synchronize_session=False
    )
    ordinal = 0
    seen: set[str] = set()
    for link in links:
        url = str(link.get("url") or "").strip()
        if not url:
            continue
        url = _absolute(url)
        destination = _destination(url)
        if destination in seen:
            # The same shop, spelled differently. Offering it twice on the card is not a
            # second purchase route.
            continue
        seen.add(destination)
        title = link.get("title")
        session.add(
            AuthorLink(
                author_id=author.id,
                kind="link",
                value=url,
                title=str(title) if isinstance(title, str) and title.strip() else None,
                ordinal=ordinal,
            )
        )
        ordinal += 1
        report.links_recorded += 1

    for mention in mentions:
        handle = str(mention).strip().lstrip("@")
        if not handle:
            continue
        session.add(AuthorLink(author_id=author.id, kind="mention", value=handle, ordinal=ordinal))
        ordinal += 1
        report.links_recorded += 1


def ingest_profiles(session: Session, directory: Path) -> AuthorReport:
    """Read `instagram_profiles.json` if it is there. Absent is a normal state."""
    report = AuthorReport()
    path = directory / PROFILE_CAPTURE
    if not path.exists():
        return report

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        report.skipped.append(f"{path.name}: {type(error).__name__}")
        return report

    rows = payload.get("profiles") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        report.skipped.append(f"{path.name}: no profiles list")
        return report

    report.files_read = 1
    for position, raw in enumerate(rows):
        if not isinstance(raw, dict):
            continue
        handle = str(raw.get("handle") or "").strip()
        if not handle:
            report.skipped.append(f"{path.name}[{position}]: no handle")
            continue
        upsert_author(
            session,
            platform="instagram",
            handle=handle,
            display_name=raw.get("display_name"),
            biography=raw.get("biography"),
            links=list(raw.get("links") or []),
            mentions=[str(m) for m in (raw.get("mentions") or [])],
            report=report,
        )

    session.commit()
    return report


def author_of(session: Session, platform: str, handle: str | None) -> Author | None:
    if not handle:
        return None
    return session.scalar(
        select(Author).where(Author.platform == platform, Author.handle == handle)
    )


__all__ = [
    "PROFILE_CAPTURE",
    "AuthorReport",
    "author_of",
    "ingest_profiles",
    "upsert_author",
]
