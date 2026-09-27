"""Read the cover of a saved Reel, and keep the reading separate from the conclusion.

Twenty of the forty-one saved music Reels carry no Instagram audio attribution. For those
the card can currently only say "릴스를 열어 직접 확인해 주세요", because both the caption
parser and the attribution parser have nothing to read. Measured over those twenty covers,
twelve have printed text and four name a track outright.

Two things are stored, and the split is the whole design:

- **`thumbnail_text`** — everything the recogniser returned, verbatim. This is shown to the
  user as what was read, and it is stored even when it is empty, so "looked and found
  nothing" is a different state from "never looked" and a re-run can tell them apart.
- **`thumbnail_track`** — the lines that look like a track reference. These become search
  candidates on the card, graded `similar` and never `exact`, because the recogniser
  demonstrably misreads (`Lullaby / JayDon, Paradise` → `ullaby / Jay pon, Paraoise`).

Both are `inference`, not `fact`. The text printed on the image is a fact; what OCR
returned is a reading of it, and those are not the same thing often enough to matter.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Evidence, Item, ItemSource, MediaAsset
from .ocr import MacvisOcrProvider, OcrProvider, OcrRead
from .providers import Unavailable

#: The Instagram Saved collection whose covers are worth reading.
#:
#: The *collection*, deliberately, not the Trends/Style/Music board. A board is a routing
#: rule that may change; this targets the thing the user themselves filed under "music",
#: which is what makes a printed song list plausible in the first place.
MUSIC_COLLECTION = "music"

#: Written here, so a re-run replaces its own output and nothing else.
OCR_TYPES = ("thumbnail_text", "thumbnail_track")

#: Hyphen, en dash, em dash. Measured over the twenty covers: every line containing one of
#: these with a space beside it was a real track reference — six for six, no false
#: positives — and no line without one was. Nothing else is treated as a separator, because
#: nothing else was measured.
#:
#: The en and em dashes are the literal characters being matched, not typography — the
#: linter's usual "did you mean a hyphen" is exactly backwards here.
SEPARATORS = ("-", "–", "—")  # noqa: RUF001


@dataclass(slots=True)
class ThumbnailReport:
    considered: int = 0
    #: Covers where the recogniser returned at least one line.
    read: int = 0
    #: Covers it read and found nothing on. A normal outcome, not a failure.
    empty: int = 0
    #: Covers already read by an earlier run.
    skipped: int = 0
    unavailable: int = 0
    #: Track-shaped lines found, across everything read this run.
    tracks: int = 0
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "considered": self.considered,
            "read": self.read,
            "empty": self.empty,
            "skipped": self.skipped,
            "unavailable": self.unavailable,
            "tracks": self.tracks,
            "reasons": self.reasons[:10],
        }


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _is_wordlike(value: str) -> bool:
    """Enough of a word to be half of a track reference.

    Two characters rather than one so `3:46` survives and a stray `m` does not, and hangul
    is spelled out because `str.isalnum()` is true for it but `str.isascii()` is not — the
    covers are mostly Korean.
    """
    kept = [c for c in value if c.isalnum() or "가" <= c <= "힣"]
    return len(kept) >= 2


def track_split(line: str) -> tuple[str, str] | None:
    """The two halves of a track reference, or `None` if this is not one.

    Deliberately does *not* say which half is the artist. `Myles Lloyd - Drive Me Crazy` is
    artist first and `i kept the light on- Don kai` is title first, both from the same
    collection, so any assignment would be wrong half the time. The halves are used only to
    decide whether the line is track-shaped; the line itself is what gets stored.
    """
    for index, character in enumerate(line):
        if character not in SEPARATORS:
            continue
        before, after = line[:index], line[index + 1 :]
        # A space on at least one side. Without this, `well-known` reads as a separator.
        if not (before.endswith(" ") or after.startswith(" ")):
            continue
        left, right = before.strip(), after.strip()
        if _is_wordlike(left) and _is_wordlike(right):
            return left, right
    return None


def thumbnail_targets(session: Session) -> list[tuple[Item, MediaAsset]]:
    """Saved music Reels whose cover is on this disk.

    `local_path` is required rather than preferred: the remote CDN URL expires, and reading
    a cover means reading a file, not fetching one. An item with no cached cover is skipped
    rather than downloaded — collection already had its chance.
    """
    rows = session.execute(
        select(Item, MediaAsset)
        .join(ItemSource, ItemSource.item_id == Item.id)
        .join(MediaAsset, MediaAsset.item_id == Item.id)
        .where(
            ItemSource.collection_name == MUSIC_COLLECTION,
            MediaAsset.local_path.is_not(None),
        )
        .order_by(ItemSource.position)
    ).all()
    return [(item, asset) for item, asset in rows]


def _already_read(session: Session, item: Item) -> bool:
    return (
        session.scalar(
            select(Evidence.id).where(
                Evidence.item_id == item.id, Evidence.type == "thumbnail_text"
            )
        )
        is not None
    )


def read_thumbnails(
    session: Session,
    *,
    provider: OcrProvider | None = None,
    media_root: str = "",
    limit: int | None = None,
    force: bool = False,
) -> ThumbnailReport:
    """Read every saved music cover that has not been read yet."""
    reader = provider or MacvisOcrProvider()
    report = ThumbnailReport()

    targets = thumbnail_targets(session)
    for item, asset in targets if limit is None else targets[:limit]:
        report.considered += 1

        if not force and _already_read(session, item):
            report.skipped += 1
            continue

        path = f"{media_root}{asset.local_path}" if media_root else str(asset.local_path)
        try:
            result = reader.read(path)
        except Exception as error:
            # CLAUDE.md §7: a failed enricher must not invalidate successful collection.
            report.unavailable += 1
            report.reasons.append(f"{item.id}: {type(error).__name__}")
            continue

        if isinstance(result, Unavailable):
            report.unavailable += 1
            report.reasons.append(f"{item.id}: {result.reason}")
            continue

        _record(session, item, result, report)

    session.commit()
    return report


def _record(session: Session, item: Item, result: OcrRead, report: ThumbnailReport) -> None:
    session.query(Evidence).filter(
        Evidence.item_id == item.id, Evidence.type.in_(OCR_TYPES)
    ).delete(synchronize_session=False)
    stamp = _now()

    # Written even when empty. Without it there is no way to tell a cover that was read and
    # had nothing on it from one nobody has looked at, and every run would redo the eight
    # covers that are pure photograph.
    session.add(
        Evidence(
            item_id=item.id,
            type="thumbnail_text",
            label="표지에서 읽은 글자",
            value=result.text,
            provenance="inference",
            source_url=item.canonical_url,
            observed_at=stamp,
            confidence=result.mean_confidence,
        )
    )

    for line in result.lines:
        if track_split(line.text) is None:
            continue
        session.add(
            Evidence(
                item_id=item.id,
                type="thumbnail_track",
                label="표지에 적힌 곡으로 보임",
                value=line.text,
                provenance="inference",
                source_url=item.canonical_url,
                observed_at=stamp,
                confidence=line.confidence,
            )
        )
        report.tracks += 1

    if result.lines:
        report.read += 1
    else:
        report.empty += 1


__all__ = [
    "MUSIC_COLLECTION",
    "OCR_TYPES",
    "SEPARATORS",
    "ThumbnailReport",
    "read_thumbnails",
    "thumbnail_targets",
    "track_split",
]
