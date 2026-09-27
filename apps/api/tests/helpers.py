"""Fixture helpers.

Tests never read the machine executing the suite. Reproducibility in CI depends on it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from taste_inbox.host.detector import FixtureHostProfileDetector
from taste_inbox.host.models import DetectedHostProfile
from taste_inbox.paths import HOST_PROFILE_FIXTURES_DIR

#: Fixed clock. The resolver takes the instant as an argument precisely so that
#: resolution stays a pure function.
RESOLVED_AT = datetime(2026, 8, 8, 7, 0, 0, tzinfo=UTC)

#: Every capacity class and pressure state the suite is obliged to cover.
ALL_PROFILE_NAMES = (
    "capacity-8gb-256gb",
    "capacity-16gb-512gb",
    "capacity-48gb-1tb",
    "low-free-storage",
    "memory-pressure-warning",
    "memory-pressure-critical",
    "unknown-pressure",
)


def host_profile_fixture_paths() -> list[Path]:
    return sorted(HOST_PROFILE_FIXTURES_DIR.glob("*.json"))


def load_host_profile(name: str) -> DetectedHostProfile:
    return FixtureHostProfileDetector(HOST_PROFILE_FIXTURES_DIR / f"{name}.json").detect()
