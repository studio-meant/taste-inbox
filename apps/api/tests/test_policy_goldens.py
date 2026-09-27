"""Cross-language contract for the resolved resource policy.

`data/fixtures/resource-policy/expected/` is the single artefact both languages agree
on: Python asserts the resolver reproduces it exactly, TypeScript asserts it validates
against `EffectiveResourcePolicySchema`. Neither side can drift without the other
failing.

Regenerate with `uv run python -m taste_inbox.host.goldens` after an intentional
resolver change, then re-derive the numbers in `test_resource_policy.py` from
docs/RESOURCE_POLICY_RESOLUTION.md by hand.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from taste_inbox.config.schema import ResourcePolicyConfig
from taste_inbox.host.policy import resolve_resource_policy
from taste_inbox.paths import RESOURCE_POLICY_FIXTURES_DIR

from .helpers import ALL_PROFILE_NAMES, RESOLVED_AT, load_host_profile

EXPECTED_DIR = RESOURCE_POLICY_FIXTURES_DIR / "expected"


def test_every_profile_has_an_expected_policy() -> None:
    present = {path.stem for path in EXPECTED_DIR.glob("*.json")}
    assert present == set(ALL_PROFILE_NAMES)


@pytest.mark.parametrize("name", ALL_PROFILE_NAMES)
def test_resolver_reproduces_the_golden(
    name: str, example_policy_config: ResourcePolicyConfig
) -> None:
    expected = json.loads((EXPECTED_DIR / f"{name}.json").read_text(encoding="utf-8"))
    policy = resolve_resource_policy(load_host_profile(name), example_policy_config, RESOLVED_AT)

    assert policy.model_dump(mode="json", by_alias=True) == expected


def test_goldens_carry_no_device_identity() -> None:
    for path in EXPECTED_DIR.glob("*.json"):
        raw = path.read_text(encoding="utf-8")
        assert "Mac" not in raw, path
        assert "/Users/" not in raw, path


def test_goldens_are_not_stale(tmp_path: Path, example_policy_config: ResourcePolicyConfig) -> None:
    """Guards against a hand-edited golden that no resolver produces."""
    for name in ALL_PROFILE_NAMES:
        policy = resolve_resource_policy(
            load_host_profile(name), example_policy_config, RESOLVED_AT
        )
        regenerated = tmp_path / f"{name}.json"
        regenerated.write_text(
            json.dumps(
                policy.model_dump(mode="json", by_alias=True),
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        assert regenerated.read_text("utf-8") == (EXPECTED_DIR / f"{name}.json").read_text("utf-8")
