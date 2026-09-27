"""Adaptive resource-policy resolver.

Pure function: no I/O, no environment, no clock. Every emitted number is derived from
the detected :class:`DetectedHostProfile`; nothing about a specific Mac model or
capacity is encoded here.

Derivation rules and their rationale: docs/RESOURCE_POLICY_RESOLUTION.md
"""

from __future__ import annotations

import math
from datetime import datetime

from taste_inbox.config.schema import ResourcePolicyConfig, TighteningOverrides
from taste_inbox.host.models import (
    PRESSURE_RANK,
    DetectedHostProfile,
    EffectiveCacheShares,
    EffectiveConcurrencyPolicy,
    EffectiveGates,
    EffectiveMemoryPolicy,
    EffectiveResourcePolicy,
    EffectiveStoragePolicy,
)

#: Usable memory budgeted for one isolated arm64 build environment.
_MEMORY_PER_BUILD_GB = 12.0
#: Upper bound on parallel builds, so the local UI stays responsive.
_MAX_AUTO_BUILDS = 3
#: Usable memory below which a resident local model and a build cannot coexist.
_LOCAL_MODEL_WITH_BUILD_MIN_USABLE_GB = 24.0


def _round_gb(value: float) -> float:
    """Half-up to two decimals. Matches the TypeScript contract exactly."""
    return math.floor(value * 100 + 0.5) / 100


def _floor_gb(value: float) -> float:
    """Floor to two decimals. Used for shares so they never exceed their budget."""
    return math.floor(value * 100) / 100


def _resolve_memory(
    profile: DetectedHostProfile,
    config: ResourcePolicyConfig,
    overrides: TighteningOverrides,
    applied: list[str],
) -> EffectiveMemoryPolicy:
    memory = config.memory
    reserve = memory.reserve_for_os_and_services

    reserved = max(reserve.min_gb, profile.unified_memory_gb * reserve.fraction_of_total)
    usable = max(0.0, profile.unified_memory_gb - reserved)

    auto = min(
        usable * memory.auto_prepare.fraction_of_usable_memory,
        profile.available_memory_gb * memory.auto_prepare.max_fraction_of_current_available,
    )
    manual = usable * memory.manual_review.fraction_of_usable_memory

    if overrides.manual_review_memory_limit_gb is not None:
        tightened = min(manual, overrides.manual_review_memory_limit_gb)
        if tightened < manual:
            applied.append("manual_review_memory_limit_gb")
        manual = tightened

    if overrides.auto_prepare_memory_limit_gb is not None:
        tightened = min(auto, overrides.auto_prepare_memory_limit_gb)
        if tightened < auto:
            applied.append("auto_prepare_memory_limit_gb")
        auto = tightened

    # Auto-prepare is the quieter budget; it can never sit above manual review.
    auto = min(auto, manual)

    return EffectiveMemoryPolicy.model_validate(
        {
            "unifiedMemoryGb": _round_gb(profile.unified_memory_gb),
            "reservedForSystemGb": _round_gb(reserved),
            "usableMemoryGb": _round_gb(usable),
            "autoPrepareLimitGb": _round_gb(auto),
            "manualReviewLimitGb": _round_gb(manual),
        }
    )


def _resolve_storage(
    profile: DetectedHostProfile,
    config: ResourcePolicyConfig,
    overrides: TighteningOverrides,
    applied: list[str],
) -> EffectiveStoragePolicy:
    storage = config.storage
    reserve = storage.reserve_free
    budget = storage.cache_budget

    reserved_free = max(reserve.min_gb, profile.total_storage_gb * reserve.fraction_of_total)

    # The one override where tightening RAISES the value: a higher untouchable reserve
    # leaves less for the cache. Applying `min` here would silently loosen the policy.
    if overrides.min_free_disk_gb is not None:
        tightened = max(reserved_free, overrides.min_free_disk_gb)
        if tightened > reserved_free:
            applied.append("min_free_disk_gb")
        reserved_free = tightened

    head_room = max(0.0, profile.free_storage_gb - reserved_free)
    cache = min(
        profile.total_storage_gb * budget.fraction_of_total,
        profile.free_storage_gb * budget.max_fraction_of_current_free,
        head_room,
    )

    if overrides.total_cache_limit_gb is not None:
        tightened = min(cache, overrides.total_cache_limit_gb)
        if tightened < cache:
            applied.append("total_cache_limit_gb")
        cache = tightened

    cache = _round_gb(cache)

    return EffectiveStoragePolicy.model_validate(
        {
            "totalStorageGb": _round_gb(profile.total_storage_gb),
            "freeStorageGb": _round_gb(profile.free_storage_gb),
            "reservedFreeGb": _round_gb(reserved_free),
            "cacheBudgetGb": cache,
            "cacheShares": EffectiveCacheShares.model_validate(
                {
                    "modelGb": _floor_gb(cache * budget.shares.model),
                    "containerGb": _floor_gb(cache * budget.shares.container),
                    "mediaGb": _floor_gb(cache * budget.shares.media),
                }
            ),
            "belowReserve": profile.free_storage_gb < reserved_free,
        }
    )


def _resolve_concurrency(
    profile: DetectedHostProfile,
    config: ResourcePolicyConfig,
    overrides: TighteningOverrides,
    usable_memory_gb: float,
    applied: list[str],
) -> EffectiveConcurrencyPolicy:
    concurrency = config.concurrency
    pressure = profile.memory_pressure

    configured_builds = concurrency.concurrent_environment_builds
    if configured_builds == "auto":
        builds = min(
            max(int(usable_memory_gb // _MEMORY_PER_BUILD_GB), 1),
            _MAX_AUTO_BUILDS,
        )
    else:
        builds = int(configured_builds)

    if pressure == "critical":
        builds = 0
    elif pressure == "warning":
        builds = min(builds, 1)

    if overrides.concurrent_environment_builds is not None:
        tightened = min(builds, overrides.concurrent_environment_builds)
        if tightened < builds:
            applied.append("concurrent_environment_builds")
        builds = tightened

    configured_local_model = concurrency.allow_local_model_while_building
    if configured_local_model == "auto":
        allow_local_model = (
            usable_memory_gb >= _LOCAL_MODEL_WITH_BUILD_MIN_USABLE_GB and pressure == "normal"
        )
    else:
        allow_local_model = bool(configured_local_model) and pressure == "normal"

    # An override may only turn this off, never on.
    if overrides.allow_local_model_while_building is False and allow_local_model:
        applied.append("allow_local_model_while_building")
        allow_local_model = False

    return EffectiveConcurrencyPolicy.model_validate(
        {
            # Sequential browser collection is an account-stability decision
            # (CLAUDE.md §7), so a larger host never widens it.
            "browserCollectors": concurrency.concurrent_browser_collectors,
            "environmentBuilds": builds,
            "allowLocalModelWhileBuilding": allow_local_model,
        }
    )


def _resolve_gates(
    profile: DetectedHostProfile,
    config: ResourcePolicyConfig,
    below_reserve: bool,
) -> EffectiveGates:
    rank = PRESSURE_RANK[profile.memory_pressure]
    pause_rank = PRESSURE_RANK[config.memory.pause_new_heavy_jobs_at_pressure]
    stop_rank = PRESSURE_RANK[config.memory.stop_heavy_jobs_at_pressure]

    pressure_blocks_new = rank >= pause_rank
    stop_running = rank >= stop_rank
    accept_new = not pressure_blocks_new and not below_reserve

    reason: str | None = None
    if stop_running:
        reason = f"memory pressure is {profile.memory_pressure}; running heavy jobs must stop"
    elif pressure_blocks_new:
        reason = f"memory pressure is {profile.memory_pressure}; new heavy jobs are paused"
    elif below_reserve:
        reason = "free storage is below the reserve; new heavy jobs are paused"
    elif profile.memory_pressure == "unknown":
        # Not a block. Recorded so the UI shows evidence rather than presenting a
        # derived limit as a measured one.
        reason = "memory pressure could not be read; limits use the conservative branch"

    return EffectiveGates.model_validate(
        {
            "acceptNewHeavyJobs": accept_new,
            "stopRunningHeavyJobs": stop_running,
            "reason": reason,
        }
    )


def resolve_resource_policy(
    profile: DetectedHostProfile,
    config: ResourcePolicyConfig,
    resolved_at: datetime,
) -> EffectiveResourcePolicy:
    """Derive effective limits for the host described by ``profile``."""
    overrides = config.tightening_overrides
    applied: list[str] = []

    memory = _resolve_memory(profile, config, overrides, applied)
    storage = _resolve_storage(profile, config, overrides, applied)
    concurrency = _resolve_concurrency(profile, config, overrides, memory.usable_memory_gb, applied)
    gates = _resolve_gates(profile, config, storage.below_reserve)

    return EffectiveResourcePolicy.model_validate(
        {
            "hostProfileId": profile.id,
            "resolvedAt": resolved_at,
            "memory": memory,
            "storage": storage,
            "concurrency": concurrency,
            "gates": gates,
            "appliedTightenings": sorted(applied),
        }
    )
