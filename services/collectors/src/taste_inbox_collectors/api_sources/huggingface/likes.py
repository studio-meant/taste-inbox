"""Hugging Face likes — models, datasets and Spaces.

    GET https://huggingface.co/api/users/{username}/likes
    → [{"createdAt": "...", "repo": {"name": "owner/repo", "type": "model"}}]

Documented in the Hub's own OpenAPI spec (`https://huggingface.co/.well-known/openapi.json`)
as `List user likes`, taking `limit` and `cursor`. Public: it answered 200 with no token
when this was written, and a token only raises the rate ceiling.

**The listing is thin on purpose.** It gives a name, a type and when the like happened —
not the tags, not the description. Everything else needs the repository's own document,
which is one more request per item; `detail=True` is what pays for that and what the
paper resolution in `papers.py` depends on, because the `arxiv:` tag lives there.

`createdAt` is the like's own timestamp. The inherited browser collectors had nothing like
it, and it is why a Hugging Face item can sit on a timeline where a scraped one could not.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

from ...capture_file import SourceItem, SourceRun
from ...http import CollectorHttpError, get_json

API_ROOT = "https://huggingface.co/api"
SITE_ROOT = "https://huggingface.co"

SURFACE = "huggingface_activity"
PLATFORM = "huggingface"

PER_PAGE = 100
MAX_PAGES = 20

#: Hub repo type → the path segment its web page lives under, and the item kind we store.
#: `model` has no segment, which is why this is a table rather than an f-string.
REPO_KINDS: dict[str, tuple[str, str]] = {
    "model": ("", "model"),
    "dataset": ("datasets/", "dataset"),
    "space": ("spaces/", "space"),
}


def canonical_url(repo_type: str, name: str) -> str | None:
    kind = REPO_KINDS.get(repo_type)
    if kind is None:
        return None
    segment, _ = kind
    return f"{SITE_ROOT}/{segment}{name}"


def detail_url(repo_type: str, name: str) -> str | None:
    if repo_type not in REPO_KINDS:
        return None
    # The API pluralises every type, including `model`, unlike the web routes above.
    return f"{API_ROOT}/{repo_type}s/{name}"


def _headers(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def fetch_detail(repo_type: str, name: str, *, token: str | None) -> dict[str, Any] | None:
    """The repository's own document, or None when it cannot be read.

    None rather than an exception: a gated or removed repository is a normal thing to find
    in a like list, and losing the whole run over one of them would be wrong.
    """

    url = detail_url(repo_type, name)
    if url is None:
        return None
    try:
        response = get_json(url, headers=_headers(token))
    except CollectorHttpError:
        return None
    return response.payload if isinstance(response.payload, dict) else None


def arxiv_ids(detail: dict[str, Any]) -> list[str]:
    """The arXiv ids this repository cites, in tag order and deduped.

    This is the thread the paper bundle is pulled from (`papers.py`). Measured on the Hub:
    models and datasets carry `arxiv:2501.12948` in `tags`; Spaces usually carry nothing,
    which is why an empty list here is the common case and not a failure.
    """

    found: list[str] = []
    for tag in detail.get("tags") or []:
        if isinstance(tag, str) and tag.startswith("arxiv:"):
            identifier = tag.removeprefix("arxiv:").strip()
            if identifier and identifier not in found:
                found.append(identifier)
    return found


def _item_from(entry: dict[str, Any], detail: dict[str, Any] | None) -> SourceItem | None:
    repo = entry.get("repo")
    if not isinstance(repo, dict):
        return None
    name = repo.get("name")
    repo_type = repo.get("type")
    if not name or not isinstance(repo_type, str):
        return None

    url = canonical_url(repo_type, str(name))
    if url is None:
        # A type the Hub added after this was written. Skipped rather than guessed at:
        # a wrong canonical URL is a dead link on a card forever.
        return None

    _, kind = REPO_KINDS[repo_type]
    owner = str(name).split("/")[0] if "/" in str(name) else None

    tags: list[str] = []
    body: str | None = None
    published: str | None = None
    if detail is not None:
        tags = [str(tag) for tag in (detail.get("tags") or []) if isinstance(tag, str)]
        pipeline = detail.get("pipeline_tag")
        if isinstance(pipeline, str) and pipeline and pipeline not in tags:
            tags.append(pipeline)
        raw_body = detail.get("description")
        if isinstance(raw_body, str) and raw_body.strip():
            body = raw_body.strip()
        created = detail.get("createdAt")
        if isinstance(created, str):
            published = created

    return SourceItem(
        platform=PLATFORM,
        # Type-qualified: a model and a dataset may share a name, and they are two items.
        platform_item_id=f"{repo_type}:{name}",
        canonical_url=url,
        kind=kind,
        title=str(name),
        body_text=body,
        owner=owner,
        source_published_at=published,
        # The like's own timestamp, straight from the listing.
        action_at=entry.get("createdAt"),
        tags=tags,
    )


def collect(
    *,
    username: str,
    token: str | None = None,
    last_seen: str | None = None,
    limit: int | None = None,
    detail: bool = True,
    max_pages: int = MAX_PAGES,
) -> SourceRun:
    """Walk the like listing newest-first, stopping at the checkpoint.

    Same stopping contract as the GitHub collector: only a run that reached the previous
    position, or ran out of listing, may advance it.
    """

    run = SourceRun(surface=SURFACE)
    if not username:
        run.outcome = "failed"
        run.stopped_because = "no Hugging Face username configured"
        return run

    headers = _headers(token)
    query = {"limit": str(PER_PAGE)}
    url: str | None = f"{API_ROOT}/users/{quote(username)}/likes?{urlencode(query)}"

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
            run.stopped_because = "likes listing was not a JSON array"
            return run
        if not entries:
            run.exhausted = True
            break

        for entry in entries:
            if not isinstance(entry, dict):
                malformed += 1
                continue
            repo = entry.get("repo") or {}
            repo_type = repo.get("type")
            name = repo.get("name")
            if not isinstance(repo_type, str) or not name:
                malformed += 1
                continue

            identity = f"{repo_type}:{name}"
            if last_seen is not None and identity == last_seen:
                reached_checkpoint = True
                break

            document = fetch_detail(repo_type, str(name), token=token) if detail else None
            item = _item_from(entry, document)
            if item is None:
                malformed += 1
                continue

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
        run.checkpoint = run.items[0].platform_item_id

    seeded_partially = limit is not None and last_seen is None and not run.exhausted
    run.advanced_checkpoint = (
        bool(run.items) and (reached_checkpoint or run.exhausted) and not seeded_partially
    )

    if malformed:
        run.note(f"{malformed} like entries were unreadable and were skipped")
    if reached_checkpoint:
        run.note("reached the previous run's newest like")

    return run


__all__ = [
    "API_ROOT",
    "MAX_PAGES",
    "PLATFORM",
    "REPO_KINDS",
    "SITE_ROOT",
    "SURFACE",
    "arxiv_ids",
    "canonical_url",
    "collect",
    "detail_url",
    "fetch_detail",
]
