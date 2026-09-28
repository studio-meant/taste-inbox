"""Where enrichment gets its facts, behind an interface.

`IMPLEMENTATION_PLAN.md` Phase 5 asks for "Search/provider adapters behind interfaces".
The interface matters more than any one adapter: a repository metadata service is a third
party that can be slow, rate-limited, or simply not configured, and none of that should
reach a card.

**An unconfigured provider is the normal state, not an error.** It returns `Unavailable`
with a reason, and the card keeps saying nothing was checked. The failure this design
prevents is a provider returning a plausible guess that the UI then renders as a finding.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Fact:
    """Something a provider read, with where it read it.

    Every enriched value carries one. `DESIGN.md` §3.5 requires the observation to be
    visible next to anything inferred from it, and this is the observation.
    """

    label: str
    value: str
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class Unavailable:
    """No answer, and why — never an empty answer that reads as "nothing found"."""

    reason: str


@dataclass(frozen=True, slots=True)
class RepositoryFacts:
    """What a repository *declares* about itself.

    Declared, not estimated. A README saying "requires 16GB" is a fact about the README;
    inferring a memory ceiling from prose would be the product inventing a number, and
    every resource affordance on the AI card would then be a claim nobody made.
    """

    full_name: str
    description: str | None = None
    primary_language: str | None = None
    #: From `pyproject.toml`, `.python-version`, or a README badge — whatever said it.
    declared_python: str | None = None
    #: True only where something in the repository names CUDA or an NVIDIA requirement.
    mentions_cuda: bool = False
    #: True where an arm64/Apple Silicon target is named explicitly.
    mentions_arm64: bool = False
    #: Environment variable names only. `docs/SECURITY_BOUNDARIES.md`: never a value.
    declared_secrets: tuple[str, ...] = ()
    license_name: str | None = None
    facts: tuple[Fact, ...] = field(default_factory=tuple)


class RepositoryProvider(Protocol):
    """Reads a repository's own declarations."""

    def fetch(self, canonical_url: str) -> RepositoryFacts | Unavailable: ...


__all__ = [
    "Fact",
    "RepositoryFacts",
    "RepositoryProvider",
    "Unavailable",
]
