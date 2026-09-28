"""Which parts of Taste Inbox are allowed to run in this source tree.

A file marker, `.taste-inbox-community`, at the repository root decides it. It is a file
rather than an environment flag on purpose: environment variables are deployment knobs and
can be dropped by launchd or changed by a wrapper, while a release boundary should travel
with the source tree and fail closed without configuration.

This tree ships `{"edition": "rnd", "apiCollection": true}`: the GitHub Stars and Hugging
Face collectors may run, on a schedule. The browser collectors the marker once also gated
were never part of this tree and were removed from the code on 2026-09-28, so the only
capability left to decide is whether collection runs at all.

**Fail closed.** An unreadable or unrecognised marker resolves to the most restrictive
profile — no collection — never a laxer one. Only a marker that readably declares
`"edition": "rnd"` unlocks the collectors.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .paths import REPO_ROOT

COMMUNITY_MARKER = ".taste-inbox-community"

#: What a damaged or foreign marker resolves to: no collectors of any kind.
COMMUNITY_EDITION = "community"
#: This distribution: the official-API collectors, on a schedule.
RND_EDITION = "rnd"


@dataclass(frozen=True, slots=True)
class DistributionProfile:
    """Capabilities fixed by the source tree being run."""

    edition: Literal["personal-workspace", "community", "rnd"]
    #: May the collectors (GitHub Stars, Hugging Face) run.
    api_collection: bool

    @property
    def collection_available(self) -> bool:
        """Whether any collector may run — what a schedule or launchd gate asks."""

        return self.api_collection


_PERSONAL = DistributionProfile(edition="personal-workspace", api_collection=True)
_COMMUNITY = DistributionProfile(edition="community", api_collection=False)
_RND = DistributionProfile(edition="rnd", api_collection=True)


def distribution_profile(root: Path = REPO_ROOT) -> DistributionProfile:
    """Resolve the immutable release profile for ``root``.

    Presence wins even when the marker is empty or malformed: a damaged marker grants
    nothing.
    """

    marker = root / COMMUNITY_MARKER
    if not marker.exists():
        return _PERSONAL

    try:
        declared = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _COMMUNITY

    if isinstance(declared, dict) and declared.get("edition") == RND_EDITION:
        return _RND
    return _COMMUNITY


def api_collection_available(root: Path = REPO_ROOT) -> bool:
    """Whether this distribution may run the collectors."""

    return distribution_profile(root).api_collection


def collection_available(root: Path = REPO_ROOT) -> bool:
    """Whether any collector may run, which is what scheduling gates ask."""

    return distribution_profile(root).collection_available


__all__ = [
    "COMMUNITY_EDITION",
    "COMMUNITY_MARKER",
    "RND_EDITION",
    "DistributionProfile",
    "api_collection_available",
    "collection_available",
    "distribution_profile",
]
