"""Turning collected tags into the words a taste context is written in.

**Deterministic, and no model is involved.** The classifier in `enrich/` sends text off
this machine and is careful about it; this module must not become a second such place. A
taste context is assembled from rows the database already has, so it stays local, it is
reproducible, and every term in it can be traced to the item that contributed it.

The transformations here are small on purpose — case folding, a stop list, and a few
platform-specific shapes (`arxiv:2501.12948`, `license:mit`) that are identifiers rather
than topics. Anything cleverer would be inference, and inference belongs beside evidence.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable

#: Tag namespaces the Hub uses for machine facts rather than topics.
#:
#: They are excellent keys and terrible vocabulary: `region:us` says nothing about what a
#: person is interested in, and `arxiv:2501.12948` is a join key this product follows
#: elsewhere (`bundle/paper.py`) rather than a word to describe taste with.
_IDENTIFIER_PREFIXES = (
    "arxiv:",
    "license:",
    "region:",
    "doi:",
    "base_model:",
    "dataset:",
    "modality:",
    # Measured, not guessed: a first context built from twelve real items ranked
    # `format:parquet` and `library:polars` among its top terms. Those describe how a
    # dataset is stored, which every dataset on the Hub answers, so they separated
    # nothing while crowding out the words that did.
    "format:",
    "library:",
    "size_categories:",
    "language:",
    "task_categories:",
    "annotations_creators:",
    "source_datasets:",
    "croissant",
)

#: Words that appear on so much of the Hub and GitHub that they separate nothing.
#:
#: Chosen by what they cost rather than by taste: a term present on most items cannot
#: distinguish one item from another, which is the only job a context term has.
_STOP_TERMS = frozenset(
    {
        "ai",
        "api",
        "app",
        "awesome",
        "code",
        "data",
        "deep-learning",
        "demo",
        "endpoints_compatible",
        "example",
        "framework",
        "library",
        "machine-learning",
        "ml",
        "model",
        "open-source",
        "python",
        "pytorch",
        "research",
        "safetensors",
        "text-generation-inference",
        "tool",
        "tools",
        "transformers",
        "typescript",
        "javascript",
    }
)

_SEPARATORS = re.compile(r"[\s_/]+")


def normalise(tag: str) -> str | None:
    """One tag as a context term, or None when it is not one.

    Returning None rather than an empty string so a caller cannot accidentally count the
    absence of a term as a term.
    """

    value = tag.strip().lower()
    if not value:
        return None
    if any(value.startswith(prefix) for prefix in _IDENTIFIER_PREFIXES):
        return None
    value = _SEPARATORS.sub("-", value).strip("-")
    if len(value) < 2 or value in _STOP_TERMS:
        return None
    # A pure number is a version or a count somewhere upstream, never a topic.
    if value.replace("-", "").isdigit():
        return None
    return value


def terms_of(tags: Iterable[str]) -> list[str]:
    """The context terms in a single item's tags, deduped and in tag order."""

    found: list[str] = []
    for tag in tags:
        term = normalise(tag)
        if term is not None and term not in found:
            found.append(term)
    return found


def rank(
    documents: Iterable[Iterable[str]], *, limit: int = 12, minimum: int = 2
) -> list[tuple[str, int]]:
    """The terms that recur across items, most frequent first.

    `minimum` defaults to 2 because a term that appeared once describes one item, not a
    taste. A context built from single occurrences would say the user is interested in
    everything they have ever saved, which is true and useless.

    Ties break alphabetically so the same rows always produce the same context — a
    research brief that changed between two identical runs would make its own results
    impossible to compare.
    """

    counter: Counter[str] = Counter()
    for tags in documents:
        counter.update(set(terms_of(tags)))
    ranked = [(term, count) for term, count in counter.items() if count >= minimum]
    ranked.sort(key=lambda pair: (-pair[1], pair[0]))
    return ranked[:limit]


__all__ = ["normalise", "rank", "terms_of"]
