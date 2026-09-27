"""Hugging Face, as one source.

The UI says "Hugging Face" and means one thing. Behind it are four adapters that differ in
what the Hub actually offers, and the split is an implementation detail nobody should have
to learn:

    HuggingFaceConnector
    ├── get_liked_models()      ✅ official   GET /api/users/{u}/likes → type=model
    ├── get_liked_datasets()    ✅ official   …                       → type=dataset
    ├── get_liked_spaces()      ✅ official   …                       → type=space
    ├── resolve_papers()        ✅ official   tags[arxiv:*] → GET /api/papers/{id}
    └── get_upvoted_papers()    ❌ no public API — see `upvotes.py`

One collection cycle walks the likes once and then resolves the papers those likes point
at, so a liked model and the paper it implements arrive together and land on the same day.
"""

from __future__ import annotations

from ...capture_file import SourceRun
from . import likes, papers, upvotes
from .likes import PLATFORM, SURFACE

__all__ = [
    "PLATFORM",
    "SURFACE",
    "collect_activity",
    "likes",
    "papers",
    "upvotes",
]


def collect_activity(
    *,
    username: str,
    token: str | None = None,
    last_seen: str | None = None,
    limit: int | None = None,
    resolve_papers: bool = True,
    max_papers: int | None = None,
) -> SourceRun:
    """Likes first, then the papers those likes cite.

    Papers are appended to the same run rather than collected as their own surface. They
    have no signal of their own — nobody starred a paper here — so they belong to the
    cycle that found them, and giving them a separate checkpoint would invent a position
    in a listing that does not exist.
    """

    run = likes.collect(
        username=username,
        token=token,
        last_seen=last_seen,
        limit=limit,
        detail=True,
    )
    if not resolve_papers or not run.items:
        return run

    ceiling = papers.MAX_PAPERS_PER_RUN if max_papers is None else max_papers
    seen: set[str] = set()
    resolved = 0
    missing = 0

    for item in list(run.items):
        for identifier in _arxiv_ids_of(item.tags):
            if resolved >= ceiling:
                run.note(f"stopped resolving papers at the {ceiling}-per-run ceiling")
                return run
            if identifier in seen:
                continue
            seen.add(identifier)

            document = papers.fetch(identifier, token=token)
            if document is None:
                missing += 1
                continue

            # The paper inherits the like's timestamp: it entered the user's world on the
            # day they liked the artifact that cites it.
            run.items.append(papers.as_item(identifier, document, liked_at=item.action_at))
            resolved += 1

    if resolved:
        run.note(f"resolved {resolved} papers from arXiv tags on liked artifacts")
    if missing:
        run.note(f"{missing} arXiv ids had no Hugging Face paper page")
    return run


def _arxiv_ids_of(tags: list[str]) -> list[str]:
    found: list[str] = []
    for tag in tags:
        if tag.startswith("arxiv:"):
            identifier = tag.removeprefix("arxiv:").strip()
            if identifier and identifier not in found:
                found.append(identifier)
    return found
