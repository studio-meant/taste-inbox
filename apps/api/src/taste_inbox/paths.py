"""Repository-relative paths shared by the service and its tests."""

from __future__ import annotations

from pathlib import Path

# src/taste_inbox/paths.py → src/taste_inbox → src → apps/api → apps → <repo root>
REPO_ROOT: Path = Path(__file__).resolve().parents[4]

CONFIG_DIR: Path = REPO_ROOT / "config"
FIXTURES_DIR: Path = REPO_ROOT / "data" / "fixtures"
HOST_PROFILE_FIXTURES_DIR: Path = FIXTURES_DIR / "host-profiles"
RESOURCE_POLICY_FIXTURES_DIR: Path = FIXTURES_DIR / "resource-policy"

__all__ = [
    "CONFIG_DIR",
    "FIXTURES_DIR",
    "HOST_PROFILE_FIXTURES_DIR",
    "REPO_ROOT",
    "RESOURCE_POLICY_FIXTURES_DIR",
]
