"""Runtime host detection.

`HostProfileDetector` is the interface the service depends on. Two implementations
ship in Phase 0:

* :class:`MacOSHostProfileDetector` — reads the live host through `sysctl`, `vm_stat`
  and `statvfs`. Used at service startup.
* :class:`FixtureHostProfileDetector` — reads a sanitized JSON fixture. Used by tests
  and CI, which must never depend on the machine they happen to run on.

Detection is best-effort by design: an unreadable signal degrades to a documented
fallback rather than raising, because a missing pressure reading must not prevent the
service from starting.
"""

from __future__ import annotations

import hashlib
import json
import platform
import re
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

from taste_inbox.host.models import DetectedHostProfile, MemoryPressure

#: Unified memory is reported the way macOS labels it: binary gigabytes.
_BYTES_PER_MEMORY_GB = 1024**3
#: Storage is reported the way Finder and the hardware label it: decimal gigabytes.
_BYTES_PER_STORAGE_GB = 1000**3

#: `kern.memorystatus_vm_pressure_level` values.
_PRESSURE_LEVELS: dict[int, MemoryPressure] = {1: "normal", 2: "warning", 4: "critical"}

_VM_STAT_PAGE_SIZE = re.compile(r"page size of (\d+) bytes")
_VM_STAT_ROW = re.compile(r"^(.+?):\s+(\d+)\.?$", re.MULTILINE)

#: Pages that the kernel can hand to a new allocation without swapping.
_AVAILABLE_PAGE_KEYS = (
    "Pages free",
    "Pages inactive",
    "Pages speculative",
    "Pages purgeable",
)


@runtime_checkable
class HostProfileDetector(Protocol):
    """Produces the runtime hardware profile the resource policy is derived from."""

    def detect(self) -> DetectedHostProfile: ...


def _sysctl(key: str) -> str | None:
    """Read one sysctl key. Returns ``None`` when the key or binary is unavailable."""
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, shell=False
            ["/usr/sbin/sysctl", "-n", key],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value or None


def _sysctl_int(key: str) -> int | None:
    raw = _sysctl(key)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _read_memory_pressure() -> MemoryPressure:
    level = _sysctl_int("kern.memorystatus_vm_pressure_level")
    if level is None:
        return "unknown"
    return _PRESSURE_LEVELS.get(level, "unknown")


def _read_available_memory_bytes() -> int | None:
    """Approximate memory available to a new allocation, from ``vm_stat``."""
    try:
        result = subprocess.run(
            ["/usr/bin/vm_stat"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None

    page_size_match = _VM_STAT_PAGE_SIZE.search(result.stdout)
    if page_size_match is None:
        return None
    page_size = int(page_size_match.group(1))

    rows = {key.strip(): int(value) for key, value in _VM_STAT_ROW.findall(result.stdout)}
    pages = sum(rows.get(key, 0) for key in _AVAILABLE_PAGE_KEYS)
    if pages <= 0:
        return None
    return pages * page_size


def _stable_profile_id(device_model: str, chip: str, memory_bytes: int, storage_bytes: int) -> str:
    """Derive a stable, non-identifying profile id.

    Hardware UUIDs and serial numbers are sensitive assets
    (docs/SECURITY_BOUNDARIES.md) and are deliberately not used. The digest below is
    stable across restarts for the same capacity class and reveals nothing on its own.
    """
    material = f"{device_model}|{chip}|{memory_bytes}|{storage_bytes}"
    return "host-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


class MacOSHostProfileDetector:
    """Detects the Apple Silicon Mac currently running Taste Inbox."""

    def __init__(self, volume: Path | None = None) -> None:
        #: The volume the local data, media cache and model cache live on.
        self._volume = volume or Path("/")

    def detect(self) -> DetectedHostProfile:
        device_model = _sysctl("hw.model") or "unknown-model"
        chip = _sysctl("machdep.cpu.brand_string") or platform.processor() or "unknown-chip"

        memory_bytes = _sysctl_int("hw.memsize") or 0
        usage = shutil.disk_usage(self._volume)

        available_bytes = _read_available_memory_bytes()
        # Without a reading, assume nothing is spare. The resolver then falls back to
        # the usable-memory fraction, which is the conservative branch.
        available_gb = (
            round(available_bytes / _BYTES_PER_MEMORY_GB, 2) if available_bytes is not None else 0.0
        )

        return DetectedHostProfile.model_validate(
            {
                "id": _stable_profile_id(device_model, chip, memory_bytes, usage.total),
                "deviceModel": device_model,
                "chip": chip,
                "architecture": "arm64",
                "unifiedMemoryGb": round(memory_bytes / _BYTES_PER_MEMORY_GB, 2),
                "availableMemoryGb": available_gb,
                "totalStorageGb": round(usage.total / _BYTES_PER_STORAGE_GB, 2),
                "freeStorageGb": round(usage.free / _BYTES_PER_STORAGE_GB, 2),
                "memoryPressure": _read_memory_pressure(),
                "detectedAt": datetime.now(UTC).isoformat(),
            }
        )


class FixtureHostProfileDetector:
    """Reads a sanitized fixture instead of the live host.

    CI and unit tests must produce identical results on every machine, so they always
    use this implementation. See data/fixtures/README.md.
    """

    def __init__(self, fixture_path: Path) -> None:
        self._fixture_path = fixture_path

    def detect(self) -> DetectedHostProfile:
        payload = json.loads(self._fixture_path.read_text(encoding="utf-8"))
        return DetectedHostProfile.model_validate(payload)


def is_supported_host() -> bool:
    """True when the current process runs on an Apple Silicon macOS host."""
    return platform.system() == "Darwin" and platform.machine() == "arm64"
