"""Host profile model and detector interface."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from taste_inbox.host.detector import (
    FixtureHostProfileDetector,
    HostProfileDetector,
    MacOSHostProfileDetector,
    is_supported_host,
)
from taste_inbox.host.models import DetectedHostProfile, HostProfile

from .helpers import host_profile_fixture_paths, load_host_profile

FIXTURE_PATHS = host_profile_fixture_paths()


def test_fixtures_exist() -> None:
    assert FIXTURE_PATHS, "no host-profile fixtures found"


@pytest.mark.parametrize("path", FIXTURE_PATHS, ids=lambda p: p.stem)
def test_every_fixture_parses(path: Path) -> None:
    profile = FixtureHostProfileDetector(path).detect()
    assert profile.architecture == "arm64"
    assert profile.unified_memory_gb > 0


@pytest.mark.parametrize("path", FIXTURE_PATHS, ids=lambda p: p.stem)
def test_public_dto_drops_host_local_signals(path: Path) -> None:
    detected = FixtureHostProfileDetector(path).detect()
    public = detected.to_public()

    assert isinstance(public, HostProfile)
    assert not isinstance(public, DetectedHostProfile)
    assert "availableMemoryGb" not in public.model_dump(by_alias=True)
    # The documented contract, docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11.
    assert set(public.model_dump(by_alias=True)) == {
        "id",
        "deviceModel",
        "chip",
        "architecture",
        "unifiedMemoryGb",
        "totalStorageGb",
        "freeStorageGb",
        "memoryPressure",
        "detectedAt",
    }


@pytest.mark.parametrize("path", FIXTURE_PATHS, ids=lambda p: p.stem)
def test_fixtures_carry_no_device_identity(path: Path) -> None:
    raw = path.read_text(encoding="utf-8")
    assert not re.search(r"Mac ?(mini|Studio|Book|Pro)", raw, re.IGNORECASE)
    assert not re.search(r"\bM[1-9]\b", raw)
    assert "serial" not in raw.lower()


def test_required_scenarios_are_covered() -> None:
    """CLAUDE.md §9 names four profiles the suite must exercise."""
    profiles = [FixtureHostProfileDetector(p).detect() for p in FIXTURE_PATHS]

    assert any(p.unified_memory_gb == 16 and p.total_storage_gb == 512 for p in profiles)
    assert any(p.unified_memory_gb == 48 and p.total_storage_gb == 1000 for p in profiles)
    assert any(p.free_storage_gb < max(40, p.total_storage_gb * 0.10) for p in profiles)
    assert any(p.memory_pressure == "warning" for p in profiles)
    assert any(p.memory_pressure == "critical" for p in profiles)


def test_detectors_satisfy_the_protocol() -> None:
    fixture: HostProfileDetector = FixtureHostProfileDetector(FIXTURE_PATHS[0])
    live: HostProfileDetector = MacOSHostProfileDetector()

    assert isinstance(fixture, HostProfileDetector)
    assert isinstance(live, HostProfileDetector)


def test_model_rejects_a_non_arm64_architecture(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATHS[0].read_text(encoding="utf-8"))
    payload["architecture"] = "x86_64"
    broken = tmp_path / "broken.json"
    broken.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValidationError):
        FixtureHostProfileDetector(broken).detect()


def test_model_rejects_unknown_fields(tmp_path: Path) -> None:
    payload = json.loads(FIXTURE_PATHS[0].read_text(encoding="utf-8"))
    payload["serialNumber"] = "XXXX"
    broken = tmp_path / "extra.json"
    broken.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValidationError):
        FixtureHostProfileDetector(broken).detect()


def test_profiles_are_immutable() -> None:
    """A detected profile is a snapshot; nothing downstream may edit it in place."""
    profile = load_host_profile("capacity-16gb-512gb")
    with pytest.raises(ValidationError):
        profile.unified_memory_gb = 999


@pytest.mark.skipif(not is_supported_host(), reason="requires an Apple Silicon macOS host")
def test_live_detection_on_a_supported_host() -> None:
    """Runs only on a real Apple Silicon Mac; CI skips it.

    This asserts shape and plausibility, never a specific model or capacity.
    """
    profile = MacOSHostProfileDetector().detect()

    assert profile.architecture == "arm64"
    assert profile.unified_memory_gb > 0
    assert profile.total_storage_gb > 0
    assert 0 <= profile.free_storage_gb <= profile.total_storage_gb
    assert 0 <= profile.available_memory_gb <= profile.unified_memory_gb
    assert profile.memory_pressure in {"normal", "warning", "critical", "unknown"}
    assert profile.id.startswith("host-")
