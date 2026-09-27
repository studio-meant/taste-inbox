"""Turning a taste context into the question AI-Q is asked.

**This is the only text this product sends off the machine**, so what goes into it is a
boundary and not a formatting choice. `CLAUDE.md` §3 lists what may cross; this module is
where that list is enforced rather than described.

What crosses:

- the subject's **public identifiers** — a repository's `owner/name`, an arXiv id, a Hub
  repo id. All of them are already public, and none of them is about the user.
- the **terms** the library recurs on (`claude-code`, `mcp`, `ai-agents`), as words
- the **shape** of recent attention (`repo 119 · space 3 · dataset 3`), as counts

What does not:

- item titles other than the subject's, and no body text from anything
- URLs beyond the subject's own canonical one
- handles, account names, file paths, anything from `.env`
- the user's own notes

The redaction pass at the bottom is the backstop, in the spirit of
`enrich/classify.py::redact`: the shape above is the contract, and the scrub is what
catches the day someone widens a field without noticing what rides along.

`aiq-research/SKILL.md` adds its own rule that this module obeys — never put credentials
or secret values in query text. `_scrub` drops anything token-shaped rather than trusting
that no caller ever will.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..taste.context import TasteContext

#: Token shapes seen in this project's own configuration. Not an exhaustive secret
#: detector — it is a tripwire for the specific accident of a key reaching a prompt.
_SECRET_SHAPES = re.compile(
    r"\b("
    r"nvapi-[A-Za-z0-9_\-]{8,}"
    r"|tvly-[A-Za-z0-9_\-]{8,}"
    r"|gh[pousr]_[A-Za-z0-9]{16,}"
    r"|hf_[A-Za-z0-9]{16,}"
    r"|sk-[A-Za-z0-9]{16,}"
    r"|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"
    r")\b"
)

#: `@handle` and bare email addresses. The subject's `owner/name` survives because it has
#: no `@` — that asymmetry is deliberate and is why the pattern is written this way.
_HANDLE = re.compile(r"(?<![\w/])@[A-Za-z0-9_.\-]{2,}|[\w.\-]+@[\w.\-]+\.\w+")

#: Everything a brief is allowed to ask for, and nothing else.
QUESTIONS = (
    "1. What is this, and what does it let someone do *today*? Judge it against the wider "
    "ecosystem, not only against its own README.",
    "2. How does it connect to the interests listed below? Name the connection concretely; "
    "say so plainly if there is none.",
    "3. What is the smallest verifiable first step to try it? State the exact commands and "
    "the condition that would prove it worked.",
)

#: Asked only when the subject is a paper whose implementation is unknown (§2.4.4 step 5).
REPO_DISCOVERY_QUESTION = (
    "0. Which GitHub repository is the official implementation of this paper? If you are "
    "not certain, list the candidates with your confidence in each and the source that "
    "supports it. Do not present a guess as the official repository."
)


@dataclass(frozen=True, slots=True)
class ResearchBrief:
    """The question, and an account of what went into it."""

    query: str
    #: For the screen: what left this machine, in the order it appears in the query.
    disclosed: list[str]
    subject_id: str
    wants_repo_discovery: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "disclosed": self.disclosed,
            "subjectId": self.subject_id,
            "wantsRepoDiscovery": self.wants_repo_discovery,
        }


def _scrub(text: str) -> str:
    """Remove token- and handle-shaped strings. The backstop, not the boundary."""

    cleaned = _SECRET_SHAPES.sub("[redacted]", text)
    return _HANDLE.sub("[handle]", cleaned)


def _needs_repo_discovery(context: TasteContext) -> bool:
    """A paper with no repository stated by the Hub — the case AI-Q has to solve.

    Measured on real documents: `githubRepo` is absent often enough that skipping this
    would strand a large share of papers before they ever reach `Try safely`.
    """

    if context.kind != "paper":
        return False
    return not any(row.get("type") == "paper.github_repo" for row in context.stated)


def build(context: TasteContext, *, max_terms: int = 8, max_neighbours: int = 5) -> ResearchBrief:
    """Compose the brief. Deterministic, so two runs over one item are comparable."""

    disclosed: list[str] = []
    lines: list[str] = []

    subject = f"{context.title} ({context.kind}, {context.platform})"
    lines.append(f"Subject: {subject}")
    lines.append(f"URL: {context.canonical_url}")
    disclosed.extend([subject, context.canonical_url])

    # Facts the source itself stated — a paper's repository, its demos. Public, and
    # exactly what stops the research from re-deriving what the Hub already answered.
    stated = [
        f"{row['label']}: {row['value']}"
        for row in context.stated
        if row.get("type", "").startswith("paper.") and row.get("value")
    ][:6]
    if stated:
        lines.append("Known from the source: " + "; ".join(stated))
        disclosed.extend(stated)

    if context.item_terms:
        terms = context.item_terms[:max_terms]
        lines.append("Its own topics: " + ", ".join(terms))
        disclosed.append("topics: " + ", ".join(terms))

    if context.recurring_terms:
        recurring = [f"{term} ({count})" for term, count in context.recurring_terms[:max_terms]]
        lines.append(
            "What this person keeps saving, by how many saved items carry each topic: "
            + ", ".join(recurring)
        )
        disclosed.append("recurring topics: " + ", ".join(recurring))

    if context.neighbours:
        # Public repository ids and the shared topic. Deliberately not the neighbour's
        # description or its URL — the id is enough to reason about and carries less.
        neighbours = [
            f"{neighbour.title} (shares {', '.join(neighbour.shared_terms[:3])})"
            for neighbour in context.neighbours[:max_neighbours]
        ]
        lines.append("Related things they already saved: " + "; ".join(neighbours))
        disclosed.append("related saves: " + "; ".join(neighbours))

    if context.recent_total:
        shape = ", ".join(
            f"{kind} {count}" for kind, count in sorted(context.recent_kinds.items())
        )
        lines.append(f"Recent saving shape (last 30 days, {context.recent_total} items): {shape}")
        disclosed.append(f"recent shape: {shape}")

    if not context.is_grounded:
        # Said out loud so the report cannot manufacture a relationship to fill the gap.
        lines.append(
            "Note: this item shares no topics with anything else they saved recently. "
            "Do not invent a connection; say that it stands alone."
        )

    wants_discovery = _needs_repo_discovery(context)
    questions = ([REPO_DISCOVERY_QUESTION] if wants_discovery else []) + list(QUESTIONS)

    lines.append("")
    lines.append("Answer these, with citations and source URLs for every claim:")
    lines.extend(questions)
    lines.append("")
    lines.append(
        "Do not recommend anything you cannot cite. If a fact is unavailable, say it is "
        "unavailable rather than estimating it."
    )

    return ResearchBrief(
        query=_scrub("\n".join(lines)),
        disclosed=[_scrub(entry) for entry in disclosed],
        subject_id=context.item_id,
        wants_repo_discovery=wants_discovery,
    )


__all__ = ["QUESTIONS", "REPO_DISCOVERY_QUESTION", "ResearchBrief", "build"]
