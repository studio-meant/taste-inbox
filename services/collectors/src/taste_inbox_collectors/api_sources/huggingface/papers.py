"""Papers, reached through the artifacts you liked.

    GET https://huggingface.co/api/papers/{arxivId}

**There is no public API for the papers a user upvoted.** Checked against the Hub's own
OpenAPI spec (295 paths, none of them a user-upvote listing), and directly:
`/api/users/{u}/upvotes`, `/papers` and `/activity` all 404, the HTML page
`huggingface.co/{u}/upvotes` answers 401, and `/api/users/{u}/overview` exposes
`numUpvotes` as a *count* with no list behind it. Scraping a logged-in page would break
the collector boundary this product inherited, so upvotes are not a source here
(`upvotes.py` says so in code).

**What works instead is better.** A liked model or dataset carries `arxiv:<id>` in its
tags, so the artifacts already being collected name their papers. One request per id then
returns the whole bundle in a single document:

    githubRepo · githubRepoAddedBy · githubStars · projectPage · mediaUrls
    linkedModels / numTotalModels · linkedDatasets / … · linkedSpaces / …

`githubRepoAddedBy` is the field that makes the product's `Official` versus `Likely`
distinction free: `"auto"` means the Hub matched it, anything else is a person who linked
it. Papers with no `githubRepo` at all are common — GPT-4o System Card and Gemini Robotics
both lack one — and those are exactly the ones the research step has to go find.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ...capture_file import SourceItem
from ...http import CollectorHttpError, get_json
from .likes import API_ROOT, PLATFORM, SITE_ROOT

#: arXiv's modern identifier. Deliberately strict: an id we half-recognise would produce a
#: request for a paper that does not exist and a dead link on a card.
ARXIV_ID = re.compile(r"^\d{4}\.\d{4,5}(v\d+)?$")

#: How many papers one collection cycle will resolve. Each is one more request, and a
#: hundred liked models citing a hundred papers would double the run for facts that keep.
MAX_PAPERS_PER_RUN = 25


@dataclass(frozen=True, slots=True)
class Branch:
    """One arm of the bundle, with where it was read.

    Mapped straight onto the inherited `evidence` table — `type`, `label`, `value`,
    `provenance`, `source_url`, `confidence` are its columns. Keeping the shape here means
    the ingester copies rather than interprets.
    """

    type: str
    label: str
    value: str
    source_url: str | None = None
    confidence: float | None = None
    provenance: str = "huggingface"

    def as_dict(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "label": self.label,
            "value": self.value,
            "source_url": self.source_url,
            "confidence": self.confidence,
            "provenance": self.provenance,
        }


def paper_url(arxiv_id: str) -> str:
    return f"{SITE_ROOT}/papers/{arxiv_id}"


def fetch(arxiv_id: str, *, token: str | None = None) -> dict[str, Any] | None:
    """One paper document, or None when the Hub does not have that id."""

    if not ARXIV_ID.match(arxiv_id):
        return None
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        response = get_json(f"{API_ROOT}/papers/{arxiv_id}", headers=headers)
    except CollectorHttpError:
        return None
    return response.payload if isinstance(response.payload, dict) else None


def branches(paper: dict[str, Any]) -> list[Branch]:
    """The bundle arms this document actually states.

    Absent arms produce nothing. A paper with no repository must look different from one
    with a repository nobody has verified — that distinction is the whole point, and an
    empty-but-present branch would erase it.
    """

    found: list[Branch] = []

    repo = paper.get("githubRepo")
    if isinstance(repo, str) and repo.strip():
        added_by = paper.get("githubRepoAddedBy")
        # Recorded values are "auto" (the Hub matched it) and "user" (a person linked it on
        # the paper page). "user" does not say *which* person — an author is likely but not
        # stated — so the label claims a person, not an author.
        person_linked = isinstance(added_by, str) and added_by not in ("", "auto")
        found.append(
            Branch(
                type="paper.github_repo",
                # The label is what the card prints, so the provenance lives in it rather
                # than only in a number the UI would have to interpret.
                label="Code · linked by a person" if person_linked else "Code · matched by the Hub",
                value=repo.strip(),
                source_url=repo.strip(),
                # 1.0 only when a person linked it. The Hub's own automatic match is
                # strong evidence but it is still a match, and DESIGN.md §3.5 asks for the
                # difference to survive to the screen.
                confidence=1.0 if person_linked else 0.9,
            )
        )

    stars = paper.get("githubStars")
    if isinstance(stars, int):
        found.append(
            Branch(
                type="paper.github_stars",
                label="GitHub stars",
                value=str(stars),
                source_url=repo if isinstance(repo, str) else None,
            )
        )

    page = paper.get("projectPage")
    if isinstance(page, str) and page.strip():
        found.append(
            Branch(
                type="paper.project_page",
                label="Project page",
                value=page.strip(),
                source_url=page.strip(),
                confidence=1.0,
            )
        )

    for key, kind, label, segment in (
        ("linkedModels", "paper.linked_model", "Model", ""),
        ("linkedDatasets", "paper.linked_dataset", "Dataset", "datasets/"),
        ("linkedSpaces", "paper.linked_space", "Demo", "spaces/"),
    ):
        for entry in paper.get(key) or []:
            if not isinstance(entry, dict):
                continue
            identifier = entry.get("id")
            if not isinstance(identifier, str) or not identifier:
                continue
            found.append(
                Branch(
                    type=kind,
                    label=label,
                    value=identifier,
                    source_url=f"{SITE_ROOT}/{segment}{identifier}",
                    confidence=1.0,
                )
            )

    # The totals, because `linked*` is a preview and the counts are the honest size. A
    # card that says "Model 3" when the Hub knows 521 is understating by two orders.
    for key, kind, label in (
        ("numTotalModels", "paper.total_models", "Models citing this paper"),
        ("numTotalDatasets", "paper.total_datasets", "Datasets citing this paper"),
        ("numTotalSpaces", "paper.total_spaces", "Spaces citing this paper"),
    ):
        total = paper.get(key)
        if isinstance(total, int) and total > 0:
            found.append(Branch(type=kind, label=label, value=str(total)))

    return found


def as_item(arxiv_id: str, paper: dict[str, Any], *, liked_at: str | None) -> SourceItem:
    """The paper as an item, anchoring the bundle.

    `action_at` carries the *like* that led here, not an upvote — the user never acted on
    the paper directly, and claiming they did would invent a signal. The timeline still
    files it on the day the artifact was liked, which is the day it entered their world.
    """

    outbound: list[str] = []
    for key in ("githubRepo", "projectPage"):
        value = paper.get(key)
        if isinstance(value, str) and value.startswith("https://"):
            outbound.append(value)

    keywords = [
        str(word)
        for word in (paper.get("ai_keywords") or [])
        if isinstance(word, str) and word.strip()
    ]

    title = paper.get("title")
    summary = paper.get("summary")

    return SourceItem(
        platform=PLATFORM,
        platform_item_id=f"paper:{arxiv_id}",
        canonical_url=paper_url(arxiv_id),
        kind="paper",
        # The Hub wraps long titles across lines; a card would print the newline.
        title=" ".join(str(title).split()) if isinstance(title, str) else arxiv_id,
        body_text=" ".join(str(summary).split()) if isinstance(summary, str) else None,
        owner=(paper.get("organization") or {}).get("name")
        if isinstance(paper.get("organization"), dict)
        else None,
        source_published_at=paper.get("publishedAt")
        if isinstance(paper.get("publishedAt"), str)
        else None,
        action_at=liked_at,
        tags=keywords,
        outbound_urls=outbound,
        evidence=[branch.as_dict() for branch in branches(paper)],
    )


__all__ = [
    "ARXIV_ID",
    "MAX_PAPERS_PER_RUN",
    "Branch",
    "as_item",
    "branches",
    "fetch",
    "paper_url",
]
