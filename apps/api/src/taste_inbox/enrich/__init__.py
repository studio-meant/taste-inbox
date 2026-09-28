"""Enrichment: what a thing declares about itself.

The verdict — whether a repository would run on this Mac — went with the sandbox runner
(docs/DECISIONS.md, 2026-08-09). What a README states about CUDA, arm64, a Python version
or a licence is still read and stored as evidence: that is an observation about the
repository, not a promise about this machine, which is why it survived and the verdict
did not.

Every module here reads a public API about a public repository. Nothing sends collected
text anywhere — the board classifier that did went with Instagram (2026-09-28).
"""

from .github import GitHubRepositoryProvider
from .providers import Fact, RepositoryFacts, RepositoryProvider, Unavailable
from .runner import EnrichReport, enrich_repositories, repository_targets

__all__ = [
    "EnrichReport",
    "Fact",
    "GitHubRepositoryProvider",
    "RepositoryFacts",
    "RepositoryProvider",
    "Unavailable",
    "enrich_repositories",
    "repository_targets",
]
