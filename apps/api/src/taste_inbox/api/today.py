"""Today, assembled from what the database actually knows.

Part of this payload describes work that does not exist yet. `suggestedQueries` needs the
Focus engine and comes back empty rather than populated with plausible filler.

`leadConnection` and `relatedConnections` are real since 2026-09-28: a **connected
bundle** is a paper and the code, models, datasets and demos the Hugging Face paper page
states for it (`api_sources/huggingface/papers.py` writes them as `paper.*` evidence, and
`api/focus.py::_bundle` draws the same rows in the Lab). Nothing is inferred here — every
arm of a bundle is a row the Hub said, and a paper with no such rows produces no bundle.

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

from ..db.models import Checkpoint, CollectorRun, Evidence, Item, Job, JobStep
from .cards import PLATFORM_LABEL, _source_ref
from .schedule import configured_zone

#: Which collector entry belongs to which platform, for the source-status list.
COLLECTOR_PLATFORM: dict[str, str] = {
    "github_stars_api": "github",
    "huggingface_activity": "huggingface",
    "huggingface_upvotes": "huggingface",
}

#: A collector's last outcome that asks for a person. `rate_limited` is not one of them:
#: the next cycle is the retry, and nothing a person does makes it come sooner.
_NEEDS_A_PERSON = frozenset({"auth_required", "blocked", "failed"})


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
    today_start, today_end = _utc_window(moment.date(), zone)

    checkpoints = list(session.scalars(select(Checkpoint)))
    # A collector that stopped — refused, or reading a shape it no longer recognises — asks
    # for a person, and so does a blocked trial below.
    attention = sum(1 for row in checkpoints if row.last_outcome in _NEEDS_A_PERSON)
    queue = _working_queue(session)
    connections = _connections(session, today_start, today_end)
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
        "leadConnection": connections[0] if connections else None,
        "relatedConnections": connections[1:],
        "savedSummary": _saved_summary(
            session, per_day.get(today, 0), today, today_start, today_end
        ),
        "workingQueue": queue,
        "previousDays": _previous_days(session, per_day, moment, zone),
        "suggestedQueries": [],
        "sourceStatusSummary": {"sources": _source_status(session, checkpoints)},
    }


#: How many bundles the card shows: one lead plus the related items §5.2 asks for
#: ("related item 2-4개"). Beyond that the card stops being a glance.
BUNDLE_LIMIT = 5

#: The arms of a bundle, in the order a person reads them, and what each one is called.
#:
#: `github_repo` leads because it is the arm that decides whether the rest can be tried at
#: all — the Lab's whole question is whether the code runs. The counts under it are the
#: `linked_*` rows the Hub stated, not the `total_*` ceilings: a bundle says what it can
#: name, and "521 models cite this" is a fact about the paper rather than a thing to open.
_BUNDLE_ARMS: tuple[tuple[str, str], ...] = (
    ("paper.github_repo", "코드"),
    ("paper.linked_model", "모델"),
    ("paper.linked_dataset", "데이터셋"),
    ("paper.linked_space", "데모"),
)


def _connections(session: Session, today_start: str, today_end: str) -> list[dict[str, Any]]:
    """Today's connected bundles — a paper, and what the Hub says implements it.

    **Scoped to today, like every other number on this screen.** The card is headed
    "오늘의 연결" and sits beside a count of today's arrivals; a bundle from three weeks ago
    would be true and would make the card mean something different from its own heading.

    Ranked by how much of the bundle is actually openable, then by a linked repository's
    provenance: a repository a person put on the paper page (`confidence` 1.0) leads one
    the Hub matched automatically (0.9). That is the same distinction `PaperBundleCard`
    draws in the Lab, and §5.2 asks for exactly it — "낮은 confidence item은 lead보다
    related slot에 둔다".
    """

    papers = list(
        session.scalars(
            select(Item).where(
                Item.kind == "paper",
                Item.first_seen_at >= today_start,
                Item.first_seen_at < today_end,
            )
        )
    )
    if not papers:
        return []

    rows = session.scalars(
        select(Evidence)
        .where(Evidence.item_id.in_([paper.id for paper in papers]))
        .where(Evidence.type.in_([arm for arm, _ in _BUNDLE_ARMS]))
        .order_by(Evidence.id)
    ).all()

    by_item: dict[str, list[Evidence]] = {}
    for row in rows:
        by_item.setdefault(row.item_id, []).append(row)

    built: list[tuple[int, float, str, dict[str, Any]]] = []
    for paper in papers:
        arms = by_item.get(paper.id)
        if not arms:
            # A paper the Hub states nothing about is not a bundle. It is still in the
            # Inbox and still opens in the Lab; it simply has no connection to draw.
            continue

        counts = Counter(row.type for row in arms)
        note = " · ".join(
            label if counts[arm] == 1 and arm == "paper.github_repo" else f"{label} {counts[arm]}"
            for arm, label in _BUNDLE_ARMS
            if counts[arm]
        )
        repo = next((row for row in arms if row.type == "paper.github_repo"), None)
        # The repository's own confidence, because it is the only arm whose provenance
        # differs: 1.0 a person linked it, 0.9 the Hub matched it. The other arms are the
        # Hub's own listings and carry no such distinction.
        confidence = repo.confidence if repo is not None else None

        built.append(
            (
                len(arms),
                confidence or 0.0,
                paper.first_seen_at,
                {
                    "id": paper.id,
                    "kind": paper.kind,
                    "title": paper.title or paper.canonical_url,
                    "summary": (paper.body_text or "").strip(),
                    "relationNote": note or None,
                    "source": _source_ref(
                        session, paper, PLATFORM_LABEL.get(paper.platform, paper.platform)
                    ),
                    # No readiness. It meant a prepared execution environment, which went
                    # with the sandbox runner on 2026-08-09 and has no way back.
                    "readiness": None,
                    # The Lab, not the item page: a bundle is a thing to investigate.
                    "href": f"/focus/{paper.id}",
                    "confidence": confidence,
                },
            )
        )

    built.sort(key=lambda row: (-row[0], -row[1], row[2]))
    return [row[3] for row in built[:BUNDLE_LIMIT]]


#: Row order: what is moving, then what needs a person, then what is ready for one.
_QUEUE_ORDER = {
    "trial_running": 0,
    "research_running": 1,
    "plan_running": 2,
    "trial_blocked": 3,
    "approval_required": 4,
    "trial_ready": 5,
    "research_ready": 6,
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

    from ..research import runner as research_runner
    from ..sandbox import trial as trial_runner
    from .focus import current_suggestion

    latest: dict[tuple[str, str], Job] = {}
    for job in session.scalars(
        select(Job)
        .where(Job.type.in_(("research", "plan", "trial")), Job.target_id.is_not(None))
        .order_by(Job.created_at, Job.id)
    ):
        latest[(str(job.target_id), job.type)] = job

    rows: list[dict[str, Any]] = []
    for item_id in {target for target, _ in latest}:
        item = session.get(Item, item_id)
        if item is None:
            continue
        research_job = latest.get((item_id, "research"))
        plan_job = latest.get((item_id, "plan"))
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
        elif plan_job is not None and plan_job.state in _ACTIVE:
            row |= {
                "kind": "plan_running",
                "nextStep": plan_job.current_step or "검증 설계 대기 중",
                "progress": _progress(session, plan_job),
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
            # The same composer the Lab draws and `POST /api/trials` runs, so a row that
            # says "decide whether to run this" is about the plan the user would approve —
            # the question's, when they asked one.
            suggestion, _asked = current_suggestion(session, item)
            if suggestion is not None and suggestion.actionable:
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
    session: Session, new_today: int, today: str, today_start: str, today_end: str
) -> dict[str, Any]:
    platforms = sorted(
        {value for value in session.scalars(select(Item.platform).distinct()) if value}
    )
    # Today's arrivals by what they are — Repo, Paper, Dataset, Space, Model. The same axis
    # the Inbox rail counts, so a number on this card is one click from the list it counts.
    kinds = {
        str(kind): int(count)
        for kind, count in session.execute(
            select(Item.kind, func.count())
            .where(Item.first_seen_at >= today_start, Item.first_seen_at < today_end)
            .group_by(Item.kind)
        ).all()
        if kind
    }
    return {
        "newItemCount": new_today,
        "kindCounts": dict(sorted(kinds.items(), key=lambda pair: (-pair[1], pair[0]))),
        "sources": platforms,
        # Today's items, not the whole Inbox: the card is headed "N 새 항목" and counts
        # today, so the link answers with the same filter a person could set by hand.
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


def _highlights_for(session: Session, iso: str, zone: ZoneInfo) -> list[dict[str, Any]]:
    # A range, not a `LIKE 'YYYY-MM-DD%'` prefix: the prefix matches the UTC date, which is
    # a different set of items from the local day this row is labelled with.
    start, end = _utc_window(date.fromisoformat(iso), zone)
    rows = session.scalars(
        select(Item)
        .where(Item.first_seen_at >= start, Item.first_seen_at < end)
        .order_by(Item.first_seen_at.desc(), Item.id)
        .limit(3)
    ).all()
    return [
        {
            "id": item.id,
            "kind": item.kind,
            "platform": item.platform,
            "title": _title_of(item),
            "meta": PLATFORM_LABEL.get(item.platform, item.platform),
            "href": f"/items/{item.id}",
        }
        for item in rows
    ]


def _title_of(item: Item) -> str:
    if item.title:
        return item.title
    for line in (item.body_text or "").split("\n"):
        candidate = line.strip()
        if candidate and not candidate.startswith("#"):
            return candidate[:60]
    return "저장한 항목"


def _source_status(session: Session, checkpoints: list[Checkpoint]) -> list[dict[str, Any]]:
    """One row per platform, folding its collectors together.

    Hugging Face has two — likes and paper upvotes — and either one stopping is the
    platform needing a person. A platform with no checkpoint at all reports `disabled`
    rather than `failed`: never having run is not the same as having tried and stopped.
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
        if row.last_outcome in _NEEDS_A_PERSON:
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
