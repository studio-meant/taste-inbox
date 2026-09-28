"""Configuration schemas.

Shapes mirror `config/*.example.yaml`. A bad value fails at load time rather than
somewhere deep in a run.

The execution-policy section is gone with the sandbox runner it configured. What is left
here describes how much of this machine the product may use — memory, disk, cache and
concurrency — which is a question about collection and enrichment, not about running
anybody else's code.
"""

from __future__ import annotations

import json
from functools import cache
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from taste_inbox.host.models import MemoryPressure
from taste_inbox.paths import REPO_ROOT

Fraction = Annotated[float, Field(ge=0.0, le=1.0)]
NonNegative = Annotated[float, Field(ge=0.0)]

THEME_IDS_PATH = REPO_ROOT / "packages" / "ui" / "theme-ids.json"


@cache
def _theme_identity() -> tuple[frozenset[str], str]:
    payload = json.loads(THEME_IDS_PATH.read_text(encoding="utf-8"))
    return frozenset(payload["themeIds"]), str(payload["defaultThemeId"])


class _Config(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


# --------------------------------------------------------------------------- host


class HostManualOverride(_Config):
    """Test and operator escape hatch. Every field is optional and defaults to unset."""

    device: str | None = None
    chip: str | None = None
    unified_memory_gb: NonNegative | None = None
    total_storage_gb: NonNegative | None = None
    free_storage_gb: NonNegative | None = None
    memory_pressure: MemoryPressure | None = None


class HostConfig(_Config):
    detection: Literal["auto", "manual"] = "auto"
    supported_os: Literal["macos"] = "macos"
    architecture: Literal["arm64"] = "arm64"
    manual_override: HostManualOverride = HostManualOverride()


# ---------------------------------------------------------------- resource policy


class ReserveRule(_Config):
    min_gb: NonNegative
    fraction_of_total: Fraction


class AutoPrepareRule(_Config):
    fraction_of_usable_memory: Fraction
    max_fraction_of_current_available: Fraction


class ManualReviewRule(_Config):
    fraction_of_usable_memory: Fraction


class MemoryPolicyConfig(_Config):
    reserve_for_os_and_services: ReserveRule
    auto_prepare: AutoPrepareRule
    manual_review: ManualReviewRule
    pause_new_heavy_jobs_at_pressure: MemoryPressure
    stop_heavy_jobs_at_pressure: MemoryPressure


class CacheShares(_Config):
    model: Fraction
    container: Fraction
    media: Fraction

    @model_validator(mode="after")
    def _shares_must_not_exceed_the_budget(self) -> CacheShares:
        total = self.model + self.container + self.media
        if total > 1.0 + 1e-9:
            raise ValueError(f"cache shares sum to {total}, which exceeds the cache budget")
        return self


class CacheBudgetRule(_Config):
    fraction_of_total: Fraction
    max_fraction_of_current_free: Fraction
    shares: CacheShares


class StoragePolicyConfig(_Config):
    reserve_free: ReserveRule
    cache_budget: CacheBudgetRule


class ConcurrencyPolicyConfig(_Config):
    concurrent_browser_collectors: Annotated[int, Field(ge=1)]
    concurrent_environment_builds: Literal["auto"] | Annotated[int, Field(ge=0)]
    allow_local_model_while_building: Literal["auto"] | bool


class TighteningOverrides(_Config):
    """Operator values that may only reduce capability.

    `min_free_disk_gb` is the one entry where tightening *raises* the number, because it
    raises the untouchable reserve. See docs/RESOURCE_POLICY_RESOLUTION.md §7.
    """

    auto_prepare_memory_limit_gb: NonNegative | None = None
    manual_review_memory_limit_gb: NonNegative | None = None
    min_free_disk_gb: NonNegative | None = None
    total_cache_limit_gb: NonNegative | None = None
    concurrent_environment_builds: Annotated[int, Field(ge=0)] | None = None
    allow_local_model_while_building: bool | None = None


class ResourcePolicyConfig(_Config):
    mode: Literal["adaptive"] = "adaptive"
    derive_from: list[str] = Field(min_length=1)
    memory: MemoryPolicyConfig
    storage: StoragePolicyConfig
    concurrency: ConcurrencyPolicyConfig
    tightening_overrides: TighteningOverrides = TighteningOverrides()


class ResourcePolicyDocument(_Config):
    """Whole of `config/resource-policy.yaml`."""

    host: HostConfig
    resource_policy: ResourcePolicyConfig


# ------------------------------------------------------------------------- app


class AppSection(_Config):
    locale: str = "ko-KR"
    timezone: str = "Asia/Seoul"
    default_theme: str
    default_motion: Literal["cinematic", "reduced"] = "cinematic"
    data_dir: str
    #: How much of the entry sequence to play when the app is opened at `/`.
    #:
    #: `full` is Splash → Greeting → Today, which is the journey the approved reference
    #: draws. `brief` skips the Splash; `skip` goes straight to Today, which is exactly what
    #: `/` did before the two screens existed.
    #:
    #: Deliberately absent from `config/app.example.yaml`, unlike every other field here.
    #: This value's home is the Settings screen, and a line in the shipped example would make
    #: a fresh checkout report `origin: "file"` — "somebody set this" — for a choice nobody
    #: has made yet.
    ceremonial_entry: Literal["full", "brief", "skip"] = "full"

    @model_validator(mode="after")
    def _theme_must_exist(self) -> AppSection:
        known, _default = _theme_identity()
        if self.default_theme not in known:
            raise ValueError(
                f"default_theme '{self.default_theme}' is not one of the "
                f"{len(known)} themes in packages/ui/theme-ids.json"
            )
        return self


#: How many collectors the stagger is spread across — the length of
#: `api.schedule.SOURCE_ORDER` (GitHub Stars, Hugging Face likes, Hugging Face upvotes), kept
#: here as a number because config validation must not import the API layer.
#: `tests/test_api.py` asserts the two still agree.
STAGGERED_SOURCES = 3


class CollectionSection(_Config):
    """How often the collectors run.

    The interval decides freshness, never completeness: checkpoints are keyed on item ids,
    so a run that is late — or skipped for days — still collects everything since the last
    one. Changing this cannot lose anything.
    """

    #: Hours between automatic runs, counted from midnight in the configured timezone.
    #: Four by default, so a star left at 02:00 is in the Inbox by 04:00 instead of waiting
    #: for an evening run.
    #:
    #: The bounds refuse the two absurd ends rather than a wrong-ish choice: under an hour
    #: is the aggressive polling CLAUDE.md §7 forbids, and over 24 hours is no longer daily.
    interval_hours: Annotated[int, Field(ge=1, le=24)] = 4
    #: Minutes between sources, so the three collectors do not start in the same minute.
    stagger_minutes: int = Field(default=3, ge=0, le=60)
    #: Whether the UI may start a collection outside the schedule.
    allow_manual_refresh: bool = True

    @model_validator(mode="after")
    def _stagger_must_fit_inside_one_interval(self) -> CollectionSection:
        """The install takes longer than a cycle otherwise, which reads as a hang.

        **Not starvation.** A source whose offset exceeds one interval is not skipped:
        `StartInterval` counts from when each job is loaded, so a late-loaded collector
        simply runs on a later phase and still fires every `interval_hours`. Saying it
        "never gets its turn" would be describing a `StartCalendarInterval` design this
        product no longer has.

        What does go wrong is the printed install block: it spaces the `launchctl` lines
        with `sleep`, so a span past one interval means a person watching the terminal
        waits longer than a whole collection cycle before the last job is loaded, with the
        first job already having run. That is confusing rather than broken, which is why
        this is a bound and not a hard invariant.
        """
        span_minutes = self.stagger_minutes * (STAGGERED_SOURCES - 1)
        if span_minutes >= self.interval_hours * 60:
            raise ValueError(
                f"stagger_minutes {self.stagger_minutes} spreads {STAGGERED_SOURCES} sources "
                f"over {span_minutes} minutes, so installing them all takes longer than the "
                f"{self.interval_hours}-hour interval itself"
            )
        return self


class BriefingSection(_Config):
    morning_status_time: str
    evening_brief_time: str


class AppDocument(_Config):
    """Whole of `config/app.yaml`."""

    app: AppSection
    collection: CollectionSection = CollectionSection()
    briefing: BriefingSection
