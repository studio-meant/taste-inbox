"""Paper upvotes — from the public JSON the Hub's own activity page reads.

    GET https://huggingface.co/api/recent-activity
        ?activityType=upvote&feedType=user&entity={username}&limit=N[&cursor=…]

## Why this and not the official API

There is no official listing. The Hub's OpenAPI spec (295 paths) has `/api/users/{u}/likes`
and nothing for upvotes, and `huggingface.co/{u}/upvotes` answers 401. But
`huggingface.co/{u}/activity/upvotes` opens without a login, and the JSON above is what that
page loads — also without a login, and `robots.txt` is `Allow: /`. Using it is a deliberate,
user-approved exception to "official APIs only" (`docs/DECISIONS.md`, 2026-09-28), and it
comes with conditions this module keeps:

- **no login, no cookie, no token** — only what anyone can see
- **no HTML** — the JSON the page itself reads, so nothing depends on markup
- **newest first, stopping at the last upvote already collected** — one or two requests a
  cycle once seeded
- **papers only** — `targetType == "paper"`. Collections and articles are skipped: what an
  upvoted collection says about someone's interest is not clear enough to act on
- **a changed shape stops this collector, and only this one** — the run comes back
  `outcome="failed"` with `stopped_because` set to the sentence below, which is this
  package's "no answer, and why" (`CLAUDE.md` §7); likes and stars are untouched

An upvoted paper becomes the same item a liked model's arXiv tag would have produced, with
its bundle resolved through `papers.py`, and carries the *upvote's* time.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

from ...capture_file import SourceItem, SourceRun
from ...http import CollectorHttpError, get_json
from . import papers
from .likes import API_ROOT, PLATFORM

SURFACE = "huggingface_upvotes"

#: Activities per request. The page itself asks for 20.
PER_PAGE = 20

#: A ceiling on one run: a seeding run against a long history stops here.
MAX_PAGES = 10


#: Said when the response no longer looks like what this module was written against.
SHAPE_CHANGED = (
    "Hugging Face 업보트 응답의 모양이 바뀌어 수집을 멈췄어요. 공식 API가 아닌 경로라 예고 없이 "
    "바뀔 수 있어요. 좋아요 수집은 계속됩니다."
)


def listing_url(username: str, cursor: str | None = None) -> str:
    query = {
        "activityType": "upvote",
        "feedType": "user",
        "entity": username,
        "limit": str(PER_PAGE),
    }
    if cursor:
        query["cursor"] = cursor
    return f"{API_ROOT}/recent-activity?{urlencode(query, quote_via=quote)}"


def _paper_id(activity: dict[str, Any]) -> str | None:
    if activity.get("type") != "upvote" or activity.get("targetType") != "paper":
        return None
    target = activity.get("target")
    identifier = target.get("id") if isinstance(target, dict) else None
    if isinstance(identifier, str) and papers.ARXIV_ID.match(identifier):
        return identifier
    return None


def _item(
    identifier: str, activity: dict[str, Any], *, token: str | None, bundle: bool
) -> SourceItem:
    """The paper, with its bundle when the Hub has a page for it.

    When the paper document cannot be read, the activity's own target (id, title, date) is
    still the paper — the upvote happened, and losing it over a missing bundle would drop a
    signal the user did give.
    """

    document = papers.fetch(identifier, token=token) if bundle else None
    target = activity.get("target")
    fallback: dict[str, Any] = target if isinstance(target, dict) else {}
    upvoted_at = activity.get("time") if isinstance(activity.get("time"), str) else None
    return papers.as_item(identifier, document or fallback, action_at=upvoted_at)


def collect(
    *,
    username: str,
    token: str | None = None,
    last_seen: str | None = None,
    limit: int | None = None,
    resolve_papers: bool = True,
    max_pages: int = MAX_PAGES,
) -> SourceRun:
    """Walk the upvote activity newest-first, stopping at the checkpoint.

    `last_seen` is the platform id of the newest upvoted paper the previous run collected
    (`paper:<arXiv id>`). The stopping contract is the likes collector's: only a run that
    reached it, or ran out of history, may advance it.

    `token` is used only for the paper documents, never for the listing — the listing is
    read exactly as a logged-out visitor sees it.

    `resolve_papers=False` keeps the upvotes and skips the bundle request per paper. The
    same flag the likes surface takes, and it means the same thing on both: collect the
    signal, leave the enrichment to a later run (`CLAUDE.md` §7).
    """

    run = SourceRun(surface=SURFACE)
    if not username:
        run.outcome = "failed"
        run.stopped_because = "no Hugging Face username configured"
        return run

    url: str | None = listing_url(username)
    reached_checkpoint = False
    skipped: dict[str, int] = {}

    while url and run.pages < max_pages:
        try:
            response = get_json(url)
        except CollectorHttpError as error:
            run.outcome = "rate_limited" if error.retryable else "failed"
            # 404 on the *first* request is the account; on a cursor page it is the path
            # changing under us, which is a different thing to tell the user and must not
            # be reported as "no such user" on an account that answered a moment ago.
            first = run.pages == 0
            run.stopped_because = (
                f"no Hugging Face user '{username}'"
                if error.status == 404 and first
                else str(error)
            )
            return run

        run.pages += 1
        payload = response.payload
        activities = payload.get("recentActivity") if isinstance(payload, dict) else None
        if not isinstance(activities, list):
            run.outcome = "failed"
            run.stopped_because = SHAPE_CHANGED
            return run
        if not activities:
            run.exhausted = True
            break

        for activity in activities:
            if not isinstance(activity, dict):
                skipped["unreadable"] = skipped.get("unreadable", 0) + 1
                continue
            identifier = _paper_id(activity)
            if identifier is None:
                kind = str(activity.get("targetType") or "unreadable")
                skipped[kind] = skipped.get(kind, 0) + 1
                continue
            if last_seen is not None and f"paper:{identifier}" == last_seen:
                reached_checkpoint = True
                break
            run.items.append(_item(identifier, activity, token=token, bundle=resolve_papers))
            if limit is not None and len(run.items) >= limit:
                break

        if reached_checkpoint:
            break
        if limit is not None and len(run.items) >= limit:
            run.stopped_because = f"reached the requested limit of {limit}"
            break

        cursor = payload.get("cursor")
        url = listing_url(username, cursor) if isinstance(cursor, str) and cursor else None
        if url is None:
            run.exhausted = True

    if run.pages >= max_pages and not run.exhausted and not reached_checkpoint:
        run.stopped_because = f"stopped at the {max_pages}-page ceiling"

    if run.items:
        run.checkpoint = run.items[0].platform_item_id

    seeded_partially = limit is not None and last_seen is None and not run.exhausted
    run.advanced_checkpoint = (
        bool(run.items) and (reached_checkpoint or run.exhausted) and not seeded_partially
    )

    for kind, count in sorted(skipped.items()):
        run.note(f"skipped {count} upvoted {kind} (papers only)")
    if reached_checkpoint:
        run.note("reached the previous run's newest upvote")
    return run


__all__ = [
    "MAX_PAGES",
    "PER_PAGE",
    "PLATFORM",
    "SHAPE_CHANGED",
    "SURFACE",
    "collect",
    "listing_url",
]
