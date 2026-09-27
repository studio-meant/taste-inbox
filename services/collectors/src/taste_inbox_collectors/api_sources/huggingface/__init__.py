"""Hugging Face, as one source.

The UI says "Hugging Face" and means one thing. Behind it are five adapters that differ in
what the Hub actually offers, and the split is an implementation detail nobody should have
to learn:

    likes → `huggingface_activity`
    ├── liked models      ✅ official     GET /api/users/{u}/likes → type=model
    ├── liked datasets    ✅ official     …                        → type=dataset
    ├── liked Spaces      ✅ official     …                        → type=space
    └── their papers      ✅ official     tags[arxiv:*] → GET /api/papers/{id}

    upvotes → `huggingface_upvotes`
    └── upvoted papers    ⚠️ not in the spec — the public JSON the Hub's own activity
                             page reads, under the conditions in `upvotes.py` and
                             `docs/DECISIONS.md` §2026-09-28

**Two surfaces, not one, and that is the point.** A liked model's paper arrives because
the model cites it; an upvoted paper arrives because the user upvoted it. Folding them
together would make the second indistinguishable from the first, and the whole reason the
likes cycle records `like` on its papers is that nobody upvoted those. Separate surfaces
keep separate checkpoints, so the unofficial path breaking cannot stop the official one.

One likes cycle walks the likes once and then resolves the papers those likes point at, so
a liked model and the paper it implements arrive together and land on the same day.
"""

from __future__ import annotations

from ...capture_file import SourceRun
from . import likes, papers, upvotes
from .likes import PLATFORM, SURFACE
from .upvotes import SURFACE as UPVOTES_SURFACE

__all__ = [
    "PLATFORM",
    "SURFACE",
    "UPVOTES_SURFACE",
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
            run.items.append(papers.as_item(identifier, document, action_at=item.action_at))
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
