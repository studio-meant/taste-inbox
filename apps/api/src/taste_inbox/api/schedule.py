"""How often collection runs, and what a manual refresh means.

Two settings in `config/app.yaml` decide it: `collection.interval_hours`, every four hours
by default, and `collection.stagger_minutes`, which spreads the sources inside each slot so
two of them never open an account in the same minute. Changing the interval moves every
collector together; changing the stagger only changes their spacing.

Slots are counted from **local midnight** — 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 at the
default — and they restart at each midnight, the same boundary `today.py` uses for "오늘".
An interval that does not divide 24 therefore leaves a shorter last gap of the day: with 5
hours the slots are 00, 05, 10, 15, 20 and the next one is four hours later, not five. The
run lands sooner than asked, never later, which is the safe direction to be wrong in.

**The interval decides freshness, never completeness.** Checkpoints are keyed on item ids,
so a run that is late, or skipped for three days, still collects everything since the last
one. That is what makes both a four-hour cycle and a Refresh button pressed at any moment
safe, and it is worth stating plainly, because a scheduler is usually the thing that loses
data when it misfires.

These slots are the *intended* cadence. Nothing is installed yet — the payload says
`scheduled: false` — and when the launchd jobs are loaded, `StartInterval` counts from the
moment each job was loaded rather than from midnight. `launchd.py` says so where it writes
the plists.
"""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..config.loader import load_app_document
from ..config.schema import AppDocument
from ..distribution import distribution_profile
from ..paths import REPO_ROOT

#: The order sources are offset in. Instagram first because it is the collection with the
#: user's own classification, and LinkedIn last because it is the riskiest account.
#:
#: `instagram_likes` leads it as of 2026-08-12, and the three `instagram_saved_*` behind it
#: now mean something different from what they meant when this order was written. Those are
#: **ingest-only** — Instagram's saved-collection feed 404s to its own web app, so those jobs
#: read whatever `probe saved` last left in `var/captures/` and open no browser at all
#: (`ingest/collect.py::COLLECTOR_SHAPES`). Likes is the Instagram surface that still
#: answers, so it takes the position the user's own filing used to hold: first, because it is
#: the one whose freshness the boards depend on.
#:
#: Keeping the dead three in the list rather than deleting them is deliberate. They still
#: have capture files, those files still ingest, and a job that re-reads them costs one
#: `SELECT` per item; removing the ids would take the three boards' backfill off the schedule
#: to save nothing.
#:
#: `config/schema.py::STAGGERED_SOURCES` is the length of this tuple, stated there rather
#: than imported so config validation does not reach into the API layer, and pinned to it by
#: `tests/test_api.py`. Adding a source here tightens the stagger ceiling: with seven, six
#: gaps have to fit inside one interval.
#: The logged-in browser collectors. Present in this tree only as names: the package that
#: implements them stayed in the private workspace, and the distribution marker keeps them
#: off regardless (`distribution.py`). Kept so an inherited schedule still reads the same
#: and so re-adding one later is a marker change rather than a new list.
BROWSER_SOURCE_ORDER: tuple[str, ...] = (
    "instagram_likes",
    "instagram_saved_ai",
    "instagram_saved_music",
    "instagram_saved_fashion",
    "github_stars",
    "threads_reposts",
    "linkedin_reactions",
)

#: The official-API collectors this distribution actually runs (2026-09-28).
#:
#: `github_stars_api` is deliberately a different id from the browser `github_stars`. They
#: read the same account but not the same facts — the stars *page* never shows when a
#: repository was starred, while `GET /user/starred` returns `starred_at`. Sharing an id
#: would let one collector's checkpoint answer for the other's coverage.
#: `huggingface_upvotes` is last and is the only unofficial path here — the public JSON the
#: Hub's own activity page reads, under the conditions in `docs/DECISIONS.md` §2026-09-28.
#: It has its own id, and therefore its own checkpoint and its own `last_outcome`, so the
#: day the Hub changes that shape the likes collector keeps running and the Today screen
#: says which one stopped.
API_SOURCE_ORDER: tuple[str, ...] = (
    "github_stars_api",
    "huggingface_activity",
    "huggingface_upvotes",
)

#: Backwards-compatible alias. Inherited callers that mean "the browser collectors" keep
#: working; anything that means "what is actually scheduled" must call `scheduled_sources`.
SOURCE_ORDER: tuple[str, ...] = BROWSER_SOURCE_ORDER


def scheduled_sources(root: Path = REPO_ROOT) -> tuple[str, ...]:
    """Which collectors this distribution may put on a schedule.

    Two capabilities rather than one, because this tree runs API collectors while browser
    automation stays off — see `distribution.py` for why that split exists.
    """

    profile = distribution_profile(root)
    sources: tuple[str, ...] = ()
    if profile.browser_automation:
        sources += BROWSER_SOURCE_ORDER
    if profile.api_collection:
        sources += API_SOURCE_ORDER
    return sources


def local_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        # An unreadable timezone must not stop the service from answering; UTC at least
        # produces a time, and the setting is visible in the payload to be corrected.
        return ZoneInfo("UTC")


def effective_document(session: Session | None) -> AppDocument:
    """The configuration in force — the file, plus whatever Settings has overridden.

    Every reader of the schedule goes through this. Reading the file directly is what made
    the Settings screen unable to offer a single control: an override of
    `collection.interval_hours` would be stored and then ignored, so this endpoint would
    keep answering 4 while the screen showed 6 — two screens disagreeing about one value.

    The import is inside the function on purpose. `settings` imports `today`, and `today`
    imports this module, so a module-level import closes the cycle. `app.py` already
    reaches for `settings` the same way.
    """
    if session is None:
        return load_app_document()
    from .settings import effective_app_document

    return effective_app_document(session)


def configured_zone(session: Session | None = None) -> ZoneInfo:
    """The timezone the whole app reasons in.

    One resolver, because the day boundary on the Today screen and the slot boundary here
    have to be the same instant. Two independent lookups would silently disagree the
    moment one of them fell back to UTC and the other did not.
    """
    return local_zone(effective_document(session).app.timezone)


def _midnight(moment: datetime) -> datetime:
    """Local midnight of the day `moment` falls on.

    Built from the calendar date rather than by subtracting hours, so a day that is 23 or
    25 hours long still starts at 00:00.
    """
    return datetime.combine(moment.date(), time.min, tzinfo=moment.tzinfo)


def _slots(midnight: datetime, interval_hours: int) -> list[datetime]:
    return [midnight + timedelta(hours=hour) for hour in range(0, 24, interval_hours)]


def _next_run(moment: datetime, interval_hours: int, offset: timedelta) -> datetime:
    for slot in _slots(_midnight(moment), interval_hours):
        if slot + offset > moment:
            return slot + offset
    # Past the day's last slot, so the cycle restarts at the next midnight.
    return _midnight(moment + timedelta(days=1)) + offset


def describe(*, now: datetime | None = None, session: Session | None = None) -> dict[str, Any]:
    """The schedule as it currently stands, and when each source runs next."""
    document = effective_document(session)
    collection = document.collection
    zone = local_zone(document.app.timezone)
    moment = (now or datetime.now(UTC)).astimezone(zone)

    profile = distribution_profile(REPO_ROOT)
    sources = []
    for index, collector_id in enumerate(scheduled_sources(REPO_ROOT)):
        offset = timedelta(minutes=collection.stagger_minutes * index)
        run_at = _next_run(moment, collection.interval_hours, offset)
        sources.append(
            {
                "collectorId": collector_id,
                # Still the clock time of the run the screen is waiting for, as it was when
                # this was a once-a-day setting — it is simply no longer the same every day.
                "runsAt": run_at.strftime("%H:%M"),
                "nextRunAt": run_at.isoformat(),
            }
        )

    return {
        "intervalHours": collection.interval_hours,
        "timezone": document.app.timezone,
        "staggerMinutes": collection.stagger_minutes,
        "allowManualRefresh": collection.allow_manual_refresh,
        "distributionEdition": profile.edition,
        "browserAutomationAvailable": profile.browser_automation,
        # Split from the line above on 2026-09-28: this tree collects from official
        # APIs while browser automation stays off, and one boolean could not say both.
        "apiCollectionAvailable": profile.api_collection,
        # The day's slots before the stagger is applied, so the screen can say "00:00 ·
        # 04:00 · …" without recomputing the interval in the frontend.
        "dailySlots": [
            slot.strftime("%H:%M") for slot in _slots(_midnight(moment), collection.interval_hours)
        ],
        # Nothing schedules these yet — launchd is Phase 7. Saying so beats a screen that
        # implies a job is waiting when no job exists.
        "scheduled": False,
        "sources": sources,
    }


__all__ = [
    "API_SOURCE_ORDER",
    "BROWSER_SOURCE_ORDER",
    "SOURCE_ORDER",
    "configured_zone",
    "describe",
    "effective_document",
    "local_zone",
    "scheduled_sources",
]
