"""Host profile and effective-resource-policy models.

These mirror `packages/shared/src/host/*.ts` field for field. The TypeScript side is
the frontend contract; this side is what actually produces the values.

No Mac model, chip name, or capacity appears as a literal anywhere in this module.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MemoryPressure = Literal["normal", "warning", "critical", "unknown"]

#: Ordering used by the pressure gates. `unknown` is treated as `normal` for gating and
#: handled conservatively elsewhere — see docs/RESOURCE_POLICY_RESOLUTION.md §6.
PRESSURE_RANK: dict[MemoryPressure, int] = {
    "normal": 0,
    "unknown": 0,
    "warning": 1,
    "critical": 2,
}


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True)


class HostProfile(_Model):
    """The profile exposed to the frontend.

    Matches `interface HostProfile` in docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11.
    """

    id: str
    device_model: str = Field(alias="deviceModel")
    chip: str
    architecture: Literal["arm64"]
    unified_memory_gb: float = Field(alias="unifiedMemoryGb", gt=0)
    total_storage_gb: float = Field(alias="totalStorageGb", gt=0)
    free_storage_gb: float = Field(alias="freeStorageGb", ge=0)
    memory_pressure: MemoryPressure = Field(alias="memoryPressure")
    detected_at: datetime = Field(alias="detectedAt")


class DetectedHostProfile(HostProfile):
    """Backend-internal superset.

    `available_memory_gb` is volatile and host-local. It is required by
    `auto_prepare.max_fraction_of_current_available` but is never sent to the UI.
    """

    available_memory_gb: float = Field(alias="availableMemoryGb", ge=0)

    def to_public(self) -> HostProfile:
        """Narrow to the documented public DTO, dropping host-local signals."""
        return HostProfile.model_validate(
            self.model_dump(mode="json", by_alias=True, exclude={"available_memory_gb"})
        )


class EffectiveMemoryPolicy(_Model):
    unified_memory_gb: float = Field(alias="unifiedMemoryGb", ge=0)
    reserved_for_system_gb: float = Field(alias="reservedForSystemGb", ge=0)
    usable_memory_gb: float = Field(alias="usableMemoryGb", ge=0)
    auto_prepare_limit_gb: float = Field(alias="autoPrepareLimitGb", ge=0)
    manual_review_limit_gb: float = Field(alias="manualReviewLimitGb", ge=0)


class EffectiveCacheShares(_Model):
    model_gb: float = Field(alias="modelGb", ge=0)
    container_gb: float = Field(alias="containerGb", ge=0)
    media_gb: float = Field(alias="mediaGb", ge=0)


class EffectiveStoragePolicy(_Model):
    total_storage_gb: float = Field(alias="totalStorageGb", ge=0)
    free_storage_gb: float = Field(alias="freeStorageGb", ge=0)
    reserved_free_gb: float = Field(alias="reservedFreeGb", ge=0)
    cache_budget_gb: float = Field(alias="cacheBudgetGb", ge=0)
    cache_shares: EffectiveCacheShares = Field(alias="cacheShares")
    below_reserve: bool = Field(alias="belowReserve")


class EffectiveConcurrencyPolicy(_Model):
    browser_collectors: int = Field(alias="browserCollectors", ge=0)
    environment_builds: int = Field(alias="environmentBuilds", ge=0)
    allow_local_model_while_building: bool = Field(alias="allowLocalModelWhileBuilding")


class EffectiveGates(_Model):
    accept_new_heavy_jobs: bool = Field(alias="acceptNewHeavyJobs")
    stop_running_heavy_jobs: bool = Field(alias="stopRunningHeavyJobs")
    reason: str | None


class EffectiveResourcePolicy(_Model):
    host_profile_id: str = Field(alias="hostProfileId")
    resolved_at: datetime = Field(alias="resolvedAt")
    memory: EffectiveMemoryPolicy
    storage: EffectiveStoragePolicy
    concurrency: EffectiveConcurrencyPolicy
    gates: EffectiveGates
    #: Operator overrides that actually changed a value, rendered as evidence in the UI
    #: so a tightened limit is never mistaken for a hardware limit.
    applied_tightenings: list[str] = Field(alias="appliedTightenings")
