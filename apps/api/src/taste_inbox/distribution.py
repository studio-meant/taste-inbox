"""Which parts of Taste Inbox are allowed to exist in this source distribution.

The private workspace contains an operator-owned browser collector package. A community
source release does not: ``scripts/community-release.py`` omits that package and writes the
marker below. Runtime checks are still kept on the API side so copying a collector package
next to a community checkout cannot silently turn browser automation back on.

This is deliberately a file marker rather than an environment flag. Environment variables
are deployment knobs and can be dropped by launchd or changed by a wrapper; a release
boundary should travel with the source tree and fail closed without configuration.

## Why there are two capabilities and not one (2026-09-28)

The inherited marker carried a single boolean, and three very different gates read it:
*may a logged-in browser collector start*, *may a launchd job be written*, and *which
sources appear on the schedule*. Collapsing them was right while every collector was a
browser collector — turning one off turned all of them off, which is exactly what a
community release wanted.

This distribution collects from the GitHub and Hugging Face **APIs**. It must still never
start a browser collector, and it is an always-on personal agent, so it does need a
schedule. One boolean cannot say both. The capability is split in two and the marker names
an edition rather than a flag; ``docs/DECISIONS.md`` (2026-09-28) records the call.

The fail-closed rule is unchanged and now carries more weight: an unreadable or
unrecognised marker resolves to the **most restrictive** profile, never a laxer one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .paths import REPO_ROOT

COMMUNITY_MARKER = ".taste-inbox-community"

#: Written by ``scripts/community_release.py``: no collectors of any kind.
COMMUNITY_EDITION = "community"
#: This distribution: official-API collectors only, on a schedule, never a browser.
RND_EDITION = "rnd"


@dataclass(frozen=True, slots=True)
class DistributionProfile:
    """Capabilities fixed by the source tree being run."""

    edition: Literal["personal-workspace", "community", "rnd"]
    #: May a logged-in browser collector be started.
    browser_automation: bool
    #: May the official-API collectors (GitHub Stars, Hugging Face) run.
    api_collection: bool

    @property
    def collection_available(self) -> bool:
        """Whether *any* collector may run — what a schedule or launchd gate asks."""

        return self.browser_automation or self.api_collection


_PERSONAL = DistributionProfile(
    edition="personal-workspace", browser_automation=True, api_collection=True
)
_COMMUNITY = DistributionProfile(
    edition="community", browser_automation=False, api_collection=False
)
_RND = DistributionProfile(edition="rnd", browser_automation=False, api_collection=True)


def distribution_profile(root: Path = REPO_ROOT) -> DistributionProfile:
    """Resolve the immutable release profile for ``root``.

    Presence wins even when the marker is empty or malformed. A damaged marker must keep
    browser automation off, and since 2026-09-28 must not grant API collection either:
    only a marker that readably declares ``"edition": "rnd"`` unlocks the API collectors.
    """

    marker = root / COMMUNITY_MARKER
    if not marker.exists():
        return _PERSONAL

    try:
        declared = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _COMMUNITY

    if isinstance(declared, dict) and declared.get("edition") == RND_EDITION:
        # `browserAutomation` is never read back as a way to turn the browser *on*. The
        # marker may only ever tighten, so a tree claiming `true` still resolves to False.
        return _RND
    return _COMMUNITY


def browser_automation_available(root: Path = REPO_ROOT) -> bool:
    """Whether this distribution may start a logged-in browser collector."""

    return distribution_profile(root).browser_automation


def api_collection_available(root: Path = REPO_ROOT) -> bool:
    """Whether this distribution may run the official-API collectors."""

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
    "browser_automation_available",
    "collection_available",
    "distribution_profile",
]
