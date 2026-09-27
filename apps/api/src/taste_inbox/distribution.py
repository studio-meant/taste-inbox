"""Which parts of Taste Inbox are allowed to exist in this source distribution.

The private workspace contains an operator-owned browser collector package. A community
source release does not: ``scripts/community-release.py`` omits that package and writes the
marker below. Runtime checks are still kept on the API side so copying a collector package
next to a community checkout cannot silently turn browser automation back on.

This is deliberately a file marker rather than an environment flag. Environment variables
are deployment knobs and can be dropped by launchd or changed by a wrapper; a release
boundary should travel with the source tree and fail closed without configuration.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .paths import REPO_ROOT

COMMUNITY_MARKER = ".taste-inbox-community"


@dataclass(frozen=True, slots=True)
class DistributionProfile:
    """Capabilities fixed by the source tree being run."""

    edition: Literal["personal-workspace", "community"]
    browser_automation: bool


def distribution_profile(root: Path = REPO_ROOT) -> DistributionProfile:
    """Resolve the immutable release profile for ``root``.

    Presence wins even when the marker is empty or malformed. A damaged community marker
    must keep automation off, not fall back to the more permissive private workspace.
    """

    if (root / COMMUNITY_MARKER).exists():
        return DistributionProfile(edition="community", browser_automation=False)
    return DistributionProfile(edition="personal-workspace", browser_automation=True)


def browser_automation_available(root: Path = REPO_ROOT) -> bool:
    """Whether this distribution may start a logged-in browser collector."""

    return distribution_profile(root).browser_automation


__all__ = [
    "COMMUNITY_MARKER",
    "DistributionProfile",
    "browser_automation_available",
    "distribution_profile",
]
