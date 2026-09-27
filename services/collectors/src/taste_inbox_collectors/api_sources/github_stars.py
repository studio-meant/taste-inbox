"""GitHub Stars, from the official API.

    GET https://api.github.com/user/starred
    Accept: application/vnd.github.star+json

**Why the API and not the stars page.** The inherited browser collector read
`github.com/<user>?tab=stars`, and `docs/DECISIONS.md` (2026-08-08) recorded what that
cost: the page never shows *when* a repository was starred, so `action_at` was null on
every row. The starred endpoint returns `starred_at` — but only under the
`application/vnd.github.star+json` media type. Without that header the same endpoint
returns bare repository objects and the timestamp is gone again, which is the one detail
this whole module exists for.

**Two listings, one shape.** `/user/starred` is the authenticated user's own stars;
`/users/{login}/starred` is anyone's public list. The first is what the product collects;
the second is what the demo can show for a login typed into a box. They return the same
documents, so the only difference here is the URL and whether a token is attached.

Unauthenticated requests get 60 an hour, which is not enough to walk a real star list.
A token is a prerequisite, not an optimisation.
"""

from __future__ import annotations

from typing import Any

from ..capture_file import SourceItem, SourceRun
from ..http import CollectorHttpError, get_json

API_ROOT = "https://api.github.com"

#: Without this the response has no `starred_at`. See the module docstring.
STAR_MEDIA_TYPE = "application/vnd.github.star+json"

SURFACE = "github_stars_api"
PLATFORM = "github"

#: Pages, not items. GitHub caps `per_page` at 100.
PER_PAGE = 100

#: A ceiling on one run, so a first collection against a large account cannot walk for an
#: hour. An incremental run stops at the checkpoint long before this.
MAX_PAGES = 20


def _item_from(entry: dict[str, Any]) -> SourceItem | None:
    """One starred repository, or None when the entry is not usable.

    Returning None rather than raising: a single malformed row in a page of a hundred is
    not a reason to lose the other ninety-nine, and the run notes say how many were
    dropped.
    """

    repo = entry.get("repo")
    if not isinstance(repo, dict):
        return None

    repo_id = repo.get("id")
    html_url = repo.get("html_url")
    if repo_id is None or not html_url:
        return None

    owner = repo.get("owner") or {}
    topics = [str(topic) for topic in (repo.get("topics") or []) if topic]
    language = repo.get("language")
    # The language is a tag rather than its own column because that is what the boards
    # filter on, and a repository's one declared language is the same kind of fact as a
    # topic somebody applied.
    tags = [*topics, str(language)] if language else topics

    homepage = (repo.get("homepage") or "").strip()

    return SourceItem(
        platform=PLATFORM,
        # The numeric id, not `full_name`: a repository that is renamed or transferred
        # keeps its id, and dedupe keying on the name would file the same project twice.
        platform_item_id=str(repo_id),
        canonical_url=str(html_url),
        kind="repo",
        title=str(repo.get("full_name") or html_url),
        body_text=repo.get("description"),
        owner=str(owner.get("login")) if owner.get("login") else None,
        source_published_at=repo.get("created_at"),
        # The reason this collector exists.
        action_at=entry.get("starred_at"),
        tags=tags,
        outbound_urls=[homepage] if homepage.startswith("https://") else [],
    )


def collect(
    *,
    token: str | None,
    login: str | None = None,
    last_seen: str | None = None,
    limit: int | None = None,
    max_pages: int = MAX_PAGES,
) -> SourceRun:
    """Walk the star listing newest-first, stopping at the checkpoint.

    `last_seen` is a repository id from the previous run. Reaching it means this run saw
    everything new and may advance the stored position; running out of pages without
    reaching it means the listing is shorter than the gap, which is also complete.
    Stopping for any other reason — a cap, a rate limit — must not advance it.
    """

    run = SourceRun(surface=SURFACE)

    headers = {"Accept": STAR_MEDIA_TYPE, "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    if login:
        url: str | None = f"{API_ROOT}/users/{login}/starred?per_page={PER_PAGE}"
    elif token:
        url = f"{API_ROOT}/user/starred?per_page={PER_PAGE}"
    else:
        run.outcome = "auth_required"
        run.stopped_because = "no GITHUB_TOKEN and no login to read a public list from"
        return run

    malformed = 0
    reached_checkpoint = False

    while url and run.pages < max_pages:
        try:
            response = get_json(url, headers=headers)
        except CollectorHttpError as error:
            run.outcome = "rate_limited" if error.retryable else "failed"
            if error.status in (401, 403) and not error.retryable:
                run.outcome = "auth_required"
            run.stopped_because = str(error)
            return run

        run.pages += 1
        entries = response.payload
        if not isinstance(entries, list):
            run.outcome = "failed"
            run.stopped_because = "starred listing was not a JSON array"
            return run
        if not entries:
            run.exhausted = True
            break

        for entry in entries:
            if not isinstance(entry, dict):
                malformed += 1
                continue
            item = _item_from(entry)
            if item is None:
                malformed += 1
                continue

            if last_seen is not None and item.platform_item_id == last_seen:
                reached_checkpoint = True
                break

            run.items.append(item)
            if limit is not None and len(run.items) >= limit:
                break

        if reached_checkpoint:
            break
        if limit is not None and len(run.items) >= limit:
            run.stopped_because = f"reached the requested limit of {limit}"
            break

        url = response.next_url
        if url is None:
            run.exhausted = True

    if run.pages >= max_pages and not run.exhausted and not reached_checkpoint:
        run.stopped_because = f"stopped at the {max_pages}-page ceiling"

    if run.items:
        # Newest first, so the first item is the position the next run stops at.
        run.checkpoint = run.items[0].platform_item_id

    # A seeding run (`limit`, no checkpoint) deliberately leaves a gap below what it took,
    # so it must not claim the position. Every other completed walk may.
    seeded_partially = limit is not None and last_seen is None and not run.exhausted
    run.advanced_checkpoint = (
        bool(run.items) and (reached_checkpoint or run.exhausted) and not seeded_partially
    )

    if malformed:
        run.note(f"{malformed} entries had no usable repository and were skipped")
    if reached_checkpoint:
        run.note("reached the previous run's newest star")

    return run


__all__ = ["API_ROOT", "MAX_PAGES", "PLATFORM", "STAR_MEDIA_TYPE", "SURFACE", "collect"]
