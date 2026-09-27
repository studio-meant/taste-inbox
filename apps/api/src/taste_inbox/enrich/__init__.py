"""Enrichment: what a thing declares about itself.

The verdict — whether a repository would run on this Mac — went with the sandbox runner
(docs/DECISIONS.md, 2026-08-09). What a README states about CUDA, arm64, a Python version
or a licence is still read and stored as evidence: that is an observation about the
repository, not a promise about this machine, which is why it survived and the verdict
did not.

One enricher here is unlike the rest and is called out so nobody has to discover it:
`classify.py` sends text off this machine. Every other module in this package reads a local
file, a local binary or a public API about a public repository. Read
`docs/SECURITY_BOUNDARIES.md` before extending it.
"""

from .classify import (
    BoardClassifier,
    BoardInput,
    ClassifyReport,
    ClaudeCliClassifier,
    NoBoardClassifier,
    build_prompt,
    classification_targets,
    classify_boards,
)
from .github import GitHubRepositoryProvider
from .ocr import MacvisOcrProvider, NoOcrProvider, OcrProvider, OcrRead
from .providers import (
    Fact,
    NoProductProvider,
    ProductProvider,
    RepositoryFacts,
    RepositoryProvider,
    Unavailable,
)
from .runner import EnrichReport, enrich_repositories, repository_targets
from .thumbnails import ThumbnailReport, read_thumbnails, thumbnail_targets, track_split

__all__ = [
    "BoardClassifier",
    "BoardInput",
    "ClassifyReport",
    "ClaudeCliClassifier",
    "EnrichReport",
    "Fact",
    "GitHubRepositoryProvider",
    "MacvisOcrProvider",
    "NoBoardClassifier",
    "NoOcrProvider",
    "NoProductProvider",
    "OcrProvider",
    "OcrRead",
    "ProductProvider",
    "RepositoryFacts",
    "RepositoryProvider",
    "ThumbnailReport",
    "Unavailable",
    "build_prompt",
    "classification_targets",
    "classify_boards",
    "enrich_repositories",
    "read_thumbnails",
    "repository_targets",
    "thumbnail_targets",
    "track_split",
]
