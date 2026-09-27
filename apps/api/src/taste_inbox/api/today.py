"""Today, assembled from what the database actually knows.

Part of this payload describes work that does not exist yet. `leadConnection` is a
relationship between two items that something has to find, and `suggestedQueries` need
the Focus engine. Both come back empty rather than populated with plausible filler.

`workingQueue` is real since 2026-09-28: one row per item that has a research or trial
job, read from the `jobs` table and the evidence those runs left
(`PAGE_SPECIFICATIONS.md` §5.2). With no such job it is empty, and an empty working queue
is a true statement — nothing is running — which the screen already has a designed state
for. A fabricated one would be the product inventing its own activity, the failure
`DESIGN.md` §3.5 exists to prevent.

What *is* real: the counts, the per-day history, the per-source collection state, and the
saved summary. Those come from rows.

**"오늘" is the 24 hours from local midnight**, in the timezone `config/app.yaml` carries —
resolved by `schedule.py`, which anchors the collection interval on the same boundary.
`first_seen_at` is stamped in UTC, so every day here is a conversion: an item saved at
00:30 on a Seoul morning carries the *previous* UTC date, and counting the raw prefix put
it on yesterday's row while the same screen was calling that instant today.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db.models import Checkpoint, CollectorRun, Item, ItemSource, Job, JobStep, MediaAsset
from .cards import BOARD_COLLECTIONS, PLATFORM_LABEL, board_filter, board_of
from .schedule import configured_zone

#: Which collector entry belongs to which platform, for the source-status list.
COLLECTOR_PLATFORM: dict[str, str] = {
    "instagram_saved_ai": "instagram",
    "instagram_saved_music": "instagram",
    "instagram_saved_fashion": "instagram",
    "instagram_likes": "instagram",
    "github_stars": "github",
    "github_stars_api": "github",
    "huggingface_activity": "huggingface",
    "threads_reposts": "threads",
    "linkedin_reactions": "linkedin",
}


def _greeting(now: datetime) -> str:
    hour = now.hour
    if hour < 5:
        return "늦은 밤이네요"
    if hour < 12:
        return "좋은 아침이에요"
    if hour < 18:
        return "좋은 오후예요"
    return "오늘 하루 어땠나요"


#: The one shape every writer produces. See `_local_day` for why this is checked.
_STAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)")


def _local_day(value: str, zone: ZoneInfo) -> str | None:
    """The *local* calendar day a UTC timestamp falls on.

    Deliberately stricter than `datetime.fromisoformat` alone would be. `_highlights_for`
    selects the same day with a string range against `first_seen_at`, which only works for
    the exact `YYYY-MM-DDTHH:MM:SSZ` shape every writer produces (`ingest/captures.py::_now`).
    Accepting a space separator or microseconds here would count a row the range misses,
    and the two halves of Today would disagree about the same day.
    """
    if not _STAMP.fullmatch(value):
        return None
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        # An unreadable stamp is corruption, not a state: it is left out rather than
        # guessed onto a day, and the count is short by exactly the rows nobody can place.
        return None
    if stamp.tzinfo is None:
        # Every writer stamps UTC (`ingest/captures.py::_now`). Reading a bare stamp as
        # machine-local would move the boundary by however far that machine is from UTC.
        stamp = stamp.replace(tzinfo=UTC)
    return stamp.astimezone(zone).date().isoformat()


def _utc_stamp(moment: datetime) -> str:
    """A bound in the exact shape `ingest/captures.py::_now` writes.

    Every `first_seen_at` is `YYYY-MM-DDTHH:MM:SSZ` — one fixed-width UTC format — so
    `>=` and `<` on the column are chronological, and a day's window is one indexed range
    scan instead of parsing every row in Python.
    """
    return moment.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _utc_window(day: date, zone: ZoneInfo) -> tuple[str, str]:
    """The `[midnight, midnight + 24h)` bounds of a local day, as UTC stamps."""
    start = datetime.combine(day, time.min, tzinfo=zone)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone)
    return _utc_stamp(start), _utc_stamp(end)


def _first_seen_days(session: Session, zone: ZoneInfo) -> Counter[str]:
    return Counter(
        day
        for day in (
            _local_day(value, zone)
            for value in session.scalars(select(Item.first_seen_at))
            if value
        )
        if day is not None
    )


def build_today(session: Session, *, now: datetime | None = None) -> dict[str, Any]:
    # The same zone the collection interval is anchored on, so the day the screen shows and
    # the day the scheduler counts in cannot drift apart.
    zone = configured_zone(session)
    moment = (now or datetime.now(UTC)).astimezone(zone)
    today = moment.date().isoformat()

    per_day = _first_seen_days(session, zone)
    # Per board, **for today** — the split the Saved card draws under its own headline.
    #
    # These used to be whole-board totals, and the card treats them as parts of
    # `newItemCount`: it computes `other = newItemCount - ai - style` and draws a meter from
    # the three. So `10 새 항목` sat over `AI 41` and `Style 76`, a bar claiming to divide ten
    # into a hundred and seventeen, and `max(0, 10 - 41 - 76)` quietly clamping -107 to zero
    # so nothing looked broken. The reference is unambiguous about the shape it wants —
    # `17 new items · AI 11 · Style 6`, and 11 + 6 = 17.
    #
    # `board_filter` is imported rather than reimplemented: a private copy of the board rule
    # is what made this screen disagree with the boards in the first place.
    today_start, today_end = _utc_window(moment.date(), zone)
    board_counts = {
        board: (
            session.scalar(
                select(func.count())
                .select_from(Item)
                .join(ItemSource, ItemSource.item_id == Item.id)
                .where(
                    board_filter(board),
                    Item.first_seen_at >= today_start,
                    Item.first_seen_at < today_end,
                )
            )
            or 0
        )
        for board in BOARD_COLLECTIONS
    }

    checkpoints = list(session.scalars(select(Checkpoint)))
    # A collector that stopped on a challenge is the one thing on this screen that asks
    # for a person. Nothing else here is actionable yet.
    attention = sum(1 for row in checkpoints if row.last_outcome in {"auth_required", "blocked"})
    queue = _working_queue(session)
    attention += sum(1 for row in queue if row["kind"] == "trial_blocked")

    return {
        "date": today,
        # Local hour, not UTC: "좋은 아침이에요" is about the user's morning.
        "greeting": _greeting(moment),
        "counts": {
            "newItems": per_day.get(today, 0),
            # A plan that research produced and nobody has tried yet — the one thing on
            # this screen that is ready for the person rather than waiting on a machine.
            "readyActions": sum(1 for row in queue if row["kind"] == "approval_required"),
            "attention": attention,
        },
        "leadConnection": None,
        "relatedConnections": [],
        "savedSummary": _saved_summary(
            session,
            board_counts,
            per_day.get(today, 0),
            today,
            today_start,
            today_end,
        ),
        "workingQueue": queue,
        "previousDays": _previous_days(session, per_day, moment, zone),
        "suggestedQueries": [],
        "sourceStatusSummary": {"sources": _source_status(session, checkpoints)},
    }


#: Row order: what is moving, then what needs a person, then what is ready for one.
_QUEUE_ORDER = {
    "trial_running": 0,
    "research_running": 1,
    "trial_blocked": 2,
    "approval_required": 3,
    "trial_ready": 4,
    "research_ready": 5,
}

#: At most this many rows. The card is a glance, and the Focus Canvas holds the rest.
QUEUE_LIMIT = 6

_ACTIVE = ("queued", "running")


def _progress(session: Session, job: Job) -> float | None:
    steps = session.scalars(select(JobStep.state).where(JobStep.job_id == job.id)).all()
    if not steps:
        return None
    return sum(1 for state in steps if state in ("done", "skipped")) / len(steps)


def _first_failure(session: Session, job: Job) -> str | None:
    return session.scalar(
        select(JobStep.message)
        .where(JobStep.job_id == job.id, JobStep.message.is_not(None))
        .order_by(JobStep.ordinal)
    )


def _working_queue(session: Session) -> list[dict[str, Any]]:
    """One row per item with a research or trial job, in `PAGE_SPECIFICATIONS.md` §5.2 terms.

    The newest state wins: a trial running on an item hides that its research finished,
    and a finished trial hides the approval that started it. Everything is read — the job
    rows for what is happening, the evidence for what the last finished run found.
    """

    from ..action import proposal
    from ..research import runner as research_runner
    from ..sandbox import trial as trial_runner

    latest: dict[tuple[str, str], Job] = {}
    for job in session.scalars(
        select(Job)
        .where(Job.type.in_(("research", "trial")), Job.target_id.is_not(None))
        .order_by(Job.created_at, Job.id)
    ):
        latest[(str(job.target_id), job.type)] = job

    rows: list[dict[str, Any]] = []
    for item_id in {target for target, _ in latest}:
        item = session.get(Item, item_id)
        if item is None:
            continue
        research_job = latest.get((item_id, "research"))
        trial_job = latest.get((item_id, "trial"))
        row: dict[str, Any] = {
            "id": f"queue-{item_id}",
            "target": _title_of(item),
            "href": f"/focus/{item_id}",
            "progress": None,
        }

        if trial_job is not None and trial_job.state in _ACTIVE:
            row |= {
                "kind": "trial_running",
                "nextStep": trial_job.current_step or "샌드박스 준비 중",
                "progress": _progress(session, trial_job),
            }
        elif research_job is not None and research_job.state in _ACTIVE:
            row |= {
                "kind": "research_running",
                "nextStep": research_job.current_step or "조사 대기 중",
                "progress": _progress(session, research_job),
            }
        elif trial_job is not None and (
            research_job is None or trial_job.created_at >= research_job.created_at
        ):
            if trial_job.state == "succeeded":
                blocked = len((trial_runner.latest(session, item_id) or {}).get("blocked", []))
                row |= {
                    "kind": "trial_ready",
                    "nextStep": f"결과 보기 · 차단된 연결 {blocked}건" if blocked else "결과 보기",
                }
            else:
                row |= {
                    "kind": "trial_blocked",
                    "nextStep": _first_failure(session, trial_job) or "실행이 끝나지 못했어요",
                }
        else:
            research = research_runner.latest(session, item_id)
            if research is None:
                # The newest research failed and no older report exists: nothing to act
                # on and nothing sandboxed. The Focus Canvas says why; the queue does not
                # invent a kind for it.
                continue
            suggestion = proposal.build(
                subject_id=item_id,
                subject_title=_title_of(item),
                subject_url=item.canonical_url,
                report=research["report"],
            )
            if suggestion.actionable:
                row |= {"kind": "approval_required", "nextStep": "안전하게 실행할지 결정하기"}
            else:
                row |= {"kind": "research_ready", "nextStep": "조사 결과 읽기"}

        row["_at"] = max(
            (job.created_at for job in (research_job, trial_job) if job is not None), default=""
        )
        rows.append(row)

    # Newest first within each group, then the group order.
    rows.sort(key=lambda row: row["_at"], reverse=True)
    rows.sort(key=lambda row: _QUEUE_ORDER[row["kind"]])
    for row in rows:
        del row["_at"]
    return rows[:QUEUE_LIMIT]


def _saved_summary(
    session: Session,
    board_counts: dict[str, int],
    new_today: int,
    today: str,
    today_start: str,
    today_end: str,
) -> dict[str, Any]:
    platforms = sorted(
        {value for value in session.scalars(select(Item.platform).distinct()) if value}
    )
    rows = session.execute(
        select(MediaAsset, Item.canonical_url)
        .join(Item, MediaAsset.item_id == Item.id)
        .where(
            MediaAsset.local_path.is_not(None),
            Item.first_seen_at >= today_start,
            Item.first_seen_at < today_end,
        )
        .order_by(Item.first_seen_at.desc(), MediaAsset.id)
    ).all()
    previews: list[dict[str, Any]] = []
    represented: set[str] = set()
    for asset, canonical_url in rows:
        # One cover per item. A carousel should not push two other newly saved posts out of
        # a three-slot overview; its remaining photographs belong on the detail gallery.
        if asset.item_id in represented:
            continue
        represented.add(asset.item_id)
        video = "/reel/" in canonical_url
        previews.append(
            {
                "id": f"saved-preview-{asset.id}",
                "type": "video_frame" if video else "image",
                "src": f"/api/media/{asset.id}",
                "width": asset.width,
                "height": asset.height,
                "alt": asset.alt_text
                or ("최근에 저장한 릴스의 표지 이미지" if video else "최근에 저장한 항목의 사진"),
            }
        )
        if len(previews) == 3:
            break
    return {
        "newItemCount": new_today,
        "aiCount": board_counts.get("trends", 0),
        "styleCount": board_counts.get("style", 0),
        "musicCount": board_counts.get("music", 0),
        # Zero for as long as nothing files an item onto the places board — which is a real
        # number, not a placeholder, and the card draws no chip for a board that received
        # nothing today.
        "placesCount": board_counts.get("places", 0),
        "sources": platforms,
        # `preview` remains for an old desktop bundle already running while this response
        # contract is deployed. The new card renders `previews` and no abstract stand-ins.
        "preview": previews[0] if previews else None,
        "previews": previews,
        # Today's items, not the whole board.
        #
        # The card is headed "N 새 항목" and counts today, so a link that answered with all
        # 158 was contradicting the number the person just clicked. `?day=` is the calendar
        # facet the rail grew on 2026-08-10, parsed and applied by every board, so this is
        # the same filter a person could set by hand rather than a private route.
        "href": f"/library?day={today}",
    }


def _previous_days(
    session: Session, per_day: Counter[str], moment: datetime, zone: ZoneInfo
) -> list[dict[str, Any]]:
    """The last few days that actually collected something.

    Days with nothing are omitted rather than listed as zero: a run of empty rows reads as
    a broken collector when it usually means the user saved nothing.
    """
    today = moment.date()
    days: list[dict[str, Any]] = []

    for iso, count in sorted(per_day.items(), reverse=True):
        if iso == today.isoformat() or len(days) >= 5:
            continue
        days.append(
            {
                "date": iso,
                "label": _relative_label(date.fromisoformat(iso), today),
                "itemCount": count,
                "highlights": _highlights_for(session, iso, zone),
            }
        )
    return days


def _relative_label(day: date, today: date) -> str:
    delta = (today - day).days
    if delta == 1:
        return "어제"
    if delta < 7:
        return f"{delta}일 전"
    return day.isoformat()


#: How many rows to consider before giving up on filling a day's three highlights.
#:
#: The filter below runs in Python, not in SQL, so the cap has to be here rather than a
#: `LIMIT 3`. It used to be a `LIMIT 3` and that was the bug: three rows were taken and
#: *then* filtered, so a day whose first three items were all unfiled produced an empty
#: section under a heading that had already announced a count.
_HIGHLIGHT_SCAN = 60


def _highlights_for(session: Session, iso: str, zone: ZoneInfo) -> list[dict[str, Any]]:
    # A range, not a `LIKE 'YYYY-MM-DD%'` prefix: the prefix matches the UTC date, which is
    # a different set of items from the local day this row is labelled with.
    start, end = _utc_window(date.fromisoformat(iso), zone)
    rows = session.scalars(
        select(Item)
        .where(Item.first_seen_at >= start, Item.first_seen_at < end)
        .order_by(Item.first_seen_at.desc())
        .limit(_HIGHLIGHT_SCAN)
    ).all()

    highlights: list[dict[str, Any]] = []
    for item in rows:
        if len(highlights) == 3:
            break
        #
        # `board_of`, not a local copy of the rule.
        #
        # This used to map `item_sources.collection_name` through `BOARD_COLLECTIONS`, which
        # answers "which collection did the user file this into" — and GitHub, Threads and
        # LinkedIn items are filed into none, by design (`cards.PLATFORM_BOARDS`: the
        # database records what the user did, the query applies the routing). So every one
        # of them was dropped, and a day of nothing but stars and reposts rendered its
        # heading over an empty space. `board_of` asks the rules the boards themselves use,
        # which is the only answer that cannot disagree with where the item actually is.
        domain = board_of(session, item)
        if domain is None:
            continue
        # The item's own cached thumbnail, when it has one. Only Instagram media is cached,
        # so this is null for a starred repository — and the card tints by platform instead
        # of drawing a picture of something nobody photographed.
        asset = session.scalar(
            select(MediaAsset)
            .where(MediaAsset.item_id == item.id, MediaAsset.local_path.is_not(None))
            .order_by(MediaAsset.id)
        )
        highlights.append(
            {
                "id": item.id,
                "domain": domain,
                "platform": item.platform,
                "title": _title_of(item),
                "meta": PLATFORM_LABEL.get(item.platform, item.platform),
                "href": f"/items/{item.id}",
                "preview": None if asset is None else f"/api/media/{asset.id}",
            }
        )
    return highlights


def _title_of(item: Item) -> str:
    if item.title:
        return item.title
    for line in (item.body_text or "").split("\n"):
        candidate = line.strip()
        if candidate and not candidate.startswith("#"):
            return candidate[:60]
    return "저장한 게시물"


def _source_status(session: Session, checkpoints: list[Checkpoint]) -> list[dict[str, Any]]:
    """One row per platform, folding the per-collection Instagram runs together.

    A platform with no checkpoint at all reports `disabled` rather than `failed`: never
    having run is not the same as having tried and stopped.
    """
    collected: dict[str, int] = {
        row[0]: row[1]
        for row in session.execute(
            select(Item.platform, func.count()).group_by(Item.platform)
        ).all()
    }

    by_platform: dict[str, dict[str, Any]] = {}
    for row in checkpoints:
        platform = COLLECTOR_PLATFORM.get(row.collector_id)
        if platform is None:
            continue
        latest = session.scalar(
            select(CollectorRun)
            .where(CollectorRun.collector_id == row.collector_id)
            .order_by(CollectorRun.started_at.desc())
        )
        current = by_platform.setdefault(
            platform,
            {
                "platform": platform,
                "label": PLATFORM_LABEL.get(platform, platform),
                "state": "collected",
                "collectedCount": collected.get(platform, 0),
                "lastRunAt": None,
            },
        )
        if row.last_outcome in {"auth_required", "blocked"}:
            current["state"] = row.last_outcome if row.last_outcome == "auth_required" else "failed"
        started = latest.started_at if latest else None
        if started and (current["lastRunAt"] is None or started > current["lastRunAt"]):
            current["lastRunAt"] = started

    for platform, count in collected.items():
        by_platform.setdefault(
            platform,
            {
                "platform": platform,
                "label": PLATFORM_LABEL.get(platform, platform),
                # Items exist but no collector recorded a run — the seeded state, before
                # any scheduled collection has happened.
                "state": "collected",
                "collectedCount": count,
                "lastRunAt": None,
            },
        )

    return [by_platform[key] for key in sorted(by_platform)]


__all__ = ["build_today"]
