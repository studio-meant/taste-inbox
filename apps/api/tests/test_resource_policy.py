"""Adaptive resource-policy resolver.

Expected numbers below are computed by hand from
docs/RESOURCE_POLICY_RESOLUTION.md, not copied from the implementation. If the
resolver changes, these must be re-derived from the document.
"""

from __future__ import annotations

import pytest

from taste_inbox.config.schema import ResourcePolicyConfig, TighteningOverrides
from taste_inbox.host.policy import resolve_resource_policy

from .helpers import ALL_PROFILE_NAMES, RESOLVED_AT, load_host_profile

# --------------------------------------------------------------- capacity classes


def test_16gb_512gb_profile(example_policy_config: ResourcePolicyConfig) -> None:
    """reserve = max(4, 16x0.25) = 4 → usable 12; auto = min(12x0.7, 9.6x0.8) = 7.68."""
    policy = resolve_resource_policy(
        load_host_profile("capacity-16gb-512gb"), example_policy_config, RESOLVED_AT
    )

    assert policy.memory.reserved_for_system_gb == 4.0
    assert policy.memory.usable_memory_gb == 12.0
    assert policy.memory.auto_prepare_limit_gb == 7.68
    assert policy.memory.manual_review_limit_gb == 10.8

    # reserve_free = max(40, 512x0.10) = 51.2 → cache = min(102.4, 105.2, 159.2)
    assert policy.storage.reserved_free_gb == 51.2
    assert policy.storage.cache_budget_gb == 102.4
    assert policy.storage.cache_shares.model_gb == 56.32
    assert policy.storage.cache_shares.container_gb == 30.72
    assert policy.storage.cache_shares.media_gb == 15.36
    assert policy.storage.below_reserve is False

    assert policy.concurrency.environment_builds == 1
    assert policy.concurrency.allow_local_model_while_building is False
    assert policy.concurrency.browser_collectors == 1

    assert policy.gates.accept_new_heavy_jobs is True
    assert policy.gates.stop_running_heavy_jobs is False
    assert policy.applied_tightenings == []


def test_48gb_1tb_profile(example_policy_config: ResourcePolicyConfig) -> None:
    """reserve = max(4, 48x0.25) = 12 → usable 36; auto = min(25.2, 25.2) = 25.2."""
    policy = resolve_resource_policy(
        load_host_profile("capacity-48gb-1tb"), example_policy_config, RESOLVED_AT
    )

    assert policy.memory.reserved_for_system_gb == 12.0
    assert policy.memory.usable_memory_gb == 36.0
    assert policy.memory.auto_prepare_limit_gb == 25.2
    assert policy.memory.manual_review_limit_gb == 32.4

    # reserve_free = max(40, 1000x0.10) = 100 → cache = min(200, 306.4, 512.8)
    assert policy.storage.reserved_free_gb == 100.0
    assert policy.storage.cache_budget_gb == 200.0
    assert policy.storage.cache_shares.model_gb == 110.0
    assert policy.storage.cache_shares.container_gb == 60.0
    assert policy.storage.cache_shares.media_gb == 30.0

    # floor(36 / 12) = 3, capped at the auto maximum.
    assert policy.concurrency.environment_builds == 3
    assert policy.concurrency.allow_local_model_while_building is True
    assert policy.gates.accept_new_heavy_jobs is True


def test_smallest_capacity_class_hits_the_reserve_floor(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    """8x0.25 = 2 is below the 4GB floor, so the floor wins and usable drops to 4."""
    policy = resolve_resource_policy(
        load_host_profile("capacity-8gb-256gb"), example_policy_config, RESOLVED_AT
    )

    assert policy.memory.reserved_for_system_gb == 4.0
    assert policy.memory.usable_memory_gb == 4.0
    assert policy.memory.auto_prepare_limit_gb == 2.48  # min(2.8, 3.1x0.8)

    # 256x0.10 = 25.6 is below the 40GB floor, so the floor wins.
    assert policy.storage.reserved_free_gb == 40.0
    assert policy.storage.cache_budget_gb == 44.1  # min(51.2, 44.1, 48.2)

    # Builds never fall below 1 from capacity alone — only pressure can reach 0.
    assert policy.concurrency.environment_builds == 1
    assert policy.concurrency.allow_local_model_while_building is False


def test_cache_shares_never_exceed_the_budget(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    for name in ("capacity-8gb-256gb", "capacity-16gb-512gb", "capacity-48gb-1tb"):
        policy = resolve_resource_policy(
            load_host_profile(name), example_policy_config, RESOLVED_AT
        )
        shares = policy.storage.cache_shares
        total = shares.model_gb + shares.container_gb + shares.media_gb
        assert total <= policy.storage.cache_budget_gb, name


# ------------------------------------------------------------------- low storage


def test_low_free_storage_collapses_the_cache_and_pauses_new_work(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    policy = resolve_resource_policy(
        load_host_profile("low-free-storage"), example_policy_config, RESOLVED_AT
    )

    assert policy.storage.reserved_free_gb == 51.2
    assert policy.storage.below_reserve is True
    assert policy.storage.cache_budget_gb == 0.0
    assert policy.storage.cache_shares.model_gb == 0.0

    assert policy.gates.accept_new_heavy_jobs is False
    assert policy.gates.stop_running_heavy_jobs is False
    assert policy.gates.reason is not None
    assert "storage" in policy.gates.reason


# ---------------------------------------------------------------- memory pressure


def test_warning_pressure_pauses_new_work_without_stopping_running_work(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    policy = resolve_resource_policy(
        load_host_profile("memory-pressure-warning"), example_policy_config, RESOLVED_AT
    )

    assert policy.memory.usable_memory_gb == 36.0
    # Same hardware as the 48GB/1TB class, but only 9.4GB is actually available.
    assert policy.memory.auto_prepare_limit_gb == 7.52

    assert policy.concurrency.environment_builds == 1
    assert policy.concurrency.allow_local_model_while_building is False

    assert policy.gates.accept_new_heavy_jobs is False
    assert policy.gates.stop_running_heavy_jobs is False


def test_critical_pressure_stops_running_work(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    policy = resolve_resource_policy(
        load_host_profile("memory-pressure-critical"), example_policy_config, RESOLVED_AT
    )

    assert policy.memory.auto_prepare_limit_gb == 1.44
    assert policy.concurrency.environment_builds == 0
    assert policy.concurrency.allow_local_model_while_building is False
    assert policy.gates.accept_new_heavy_jobs is False
    assert policy.gates.stop_running_heavy_jobs is True


def test_unknown_pressure_does_not_block_but_is_recorded(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    policy = resolve_resource_policy(
        load_host_profile("unknown-pressure"), example_policy_config, RESOLVED_AT
    )

    assert policy.memory.usable_memory_gb == 18.0
    assert policy.memory.auto_prepare_limit_gb == 9.6  # min(12.6, 12x0.8)

    assert policy.gates.accept_new_heavy_jobs is True
    assert policy.gates.stop_running_heavy_jobs is False
    # 18GB usable would not enable it anyway, but `unknown` must disable it regardless.
    assert policy.concurrency.allow_local_model_while_building is False
    assert policy.gates.reason is not None
    assert "pressure" in policy.gates.reason


def test_pressure_changes_limits_on_identical_hardware(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    """The point of the adaptive policy: same capacity, different live pressure."""
    calm = resolve_resource_policy(
        load_host_profile("capacity-48gb-1tb"), example_policy_config, RESOLVED_AT
    )
    strained = resolve_resource_policy(
        load_host_profile("memory-pressure-warning"), example_policy_config, RESOLVED_AT
    )

    assert calm.memory.usable_memory_gb == strained.memory.usable_memory_gb
    assert strained.memory.auto_prepare_limit_gb < calm.memory.auto_prepare_limit_gb
    assert strained.concurrency.environment_builds < calm.concurrency.environment_builds


# ------------------------------------------------------------ tightening overrides


def _with_overrides(config: ResourcePolicyConfig, **overrides: object) -> ResourcePolicyConfig:
    return config.model_copy(
        update={"tightening_overrides": TighteningOverrides.model_validate(overrides)}
    )


def test_overrides_can_tighten_memory(example_policy_config: ResourcePolicyConfig) -> None:
    config = _with_overrides(example_policy_config, auto_prepare_memory_limit_gb=4.0)
    policy = resolve_resource_policy(load_host_profile("capacity-16gb-512gb"), config, RESOLVED_AT)

    assert policy.memory.auto_prepare_limit_gb == 4.0
    assert policy.applied_tightenings == ["auto_prepare_memory_limit_gb"]


def test_overrides_can_never_exceed_the_safe_capacity(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    """A locked decision: overrides may only tighten (DECISIONS.md → Resource policy)."""
    baseline = resolve_resource_policy(
        load_host_profile("capacity-16gb-512gb"), example_policy_config, RESOLVED_AT
    )
    config = _with_overrides(
        example_policy_config,
        auto_prepare_memory_limit_gb=999.0,
        manual_review_memory_limit_gb=999.0,
        total_cache_limit_gb=999.0,
        concurrent_environment_builds=99,
        allow_local_model_while_building=True,
    )
    loosened = resolve_resource_policy(
        load_host_profile("capacity-16gb-512gb"), config, RESOLVED_AT
    )

    assert loosened.memory.auto_prepare_limit_gb == baseline.memory.auto_prepare_limit_gb
    assert loosened.memory.manual_review_limit_gb == baseline.memory.manual_review_limit_gb
    assert loosened.storage.cache_budget_gb == baseline.storage.cache_budget_gb
    assert loosened.concurrency.environment_builds == baseline.concurrency.environment_builds
    assert (
        loosened.concurrency.allow_local_model_while_building
        == baseline.concurrency.allow_local_model_while_building
    )
    assert loosened.applied_tightenings == []


def test_min_free_disk_override_raises_the_reserve(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    """The one override where tightening means a larger number."""
    config = _with_overrides(example_policy_config, min_free_disk_gb=180.0)
    policy = resolve_resource_policy(load_host_profile("capacity-16gb-512gb"), config, RESOLVED_AT)

    assert policy.storage.reserved_free_gb == 180.0
    # head_room = 210.4 - 180 = 30.4, which now binds instead of the 20% budget.
    assert policy.storage.cache_budget_gb == 30.4
    assert policy.applied_tightenings == ["min_free_disk_gb"]


def test_min_free_disk_override_below_the_computed_reserve_is_ignored(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    """Applying `min` here would silently loosen the policy."""
    config = _with_overrides(example_policy_config, min_free_disk_gb=1.0)
    policy = resolve_resource_policy(load_host_profile("capacity-16gb-512gb"), config, RESOLVED_AT)

    assert policy.storage.reserved_free_gb == 51.2
    assert policy.applied_tightenings == []


def test_local_model_override_can_only_disable(
    example_policy_config: ResourcePolicyConfig,
) -> None:
    disabled = _with_overrides(example_policy_config, allow_local_model_while_building=False)
    policy = resolve_resource_policy(load_host_profile("capacity-48gb-1tb"), disabled, RESOLVED_AT)

    assert policy.concurrency.allow_local_model_while_building is False
    assert policy.applied_tightenings == ["allow_local_model_while_building"]


def test_builds_override_tightens(example_policy_config: ResourcePolicyConfig) -> None:
    config = _with_overrides(example_policy_config, concurrent_environment_builds=1)
    policy = resolve_resource_policy(load_host_profile("capacity-48gb-1tb"), config, RESOLVED_AT)

    assert policy.concurrency.environment_builds == 1
    assert policy.applied_tightenings == ["concurrent_environment_builds"]


# ------------------------------------------------------------------- determinism


@pytest.mark.parametrize("name", ALL_PROFILE_NAMES)
def test_resolution_is_deterministic(
    name: str, example_policy_config: ResourcePolicyConfig
) -> None:
    profile = load_host_profile(name)
    first = resolve_resource_policy(profile, example_policy_config, RESOLVED_AT)
    second = resolve_resource_policy(profile, example_policy_config, RESOLVED_AT)

    assert first == second


@pytest.mark.parametrize("name", ALL_PROFILE_NAMES)
def test_invariants_hold_for_every_profile(
    name: str, example_policy_config: ResourcePolicyConfig
) -> None:
    policy = resolve_resource_policy(load_host_profile(name), example_policy_config, RESOLVED_AT)

    assert policy.memory.auto_prepare_limit_gb <= policy.memory.manual_review_limit_gb
    assert policy.memory.manual_review_limit_gb <= policy.memory.usable_memory_gb
    assert policy.memory.usable_memory_gb <= policy.memory.unified_memory_gb
    assert policy.storage.cache_budget_gb <= policy.storage.total_storage_gb
    assert policy.concurrency.browser_collectors == 1
    if policy.gates.stop_running_heavy_jobs:
        assert policy.gates.accept_new_heavy_jobs is False
