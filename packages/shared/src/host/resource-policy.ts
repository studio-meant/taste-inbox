import { z } from "zod";
import { IsoDateTimeSchema, MemoryPressureSchema } from "./host-profile";

/**
 * Adaptive resource-policy contract.
 *
 * Config shape mirrors `config/resource-policy.example.yaml`. Derivation rules are
 * documented in docs/RESOURCE_POLICY_RESOLUTION.md and implemented once, in the
 * backend (`apps/api/src/taste_inbox/host/policy.py`). These types exist so the UI
 * can render the resolved policy without re-deriving it.
 */

const Fraction = z.number().min(0).max(1);
const NonNegative = z.number().nonnegative();

export const AutoOrNumberSchema = z.union([z.literal("auto"), z.number().nonnegative()]);
export const AutoOrBooleanSchema = z.union([z.literal("auto"), z.boolean()]);

export const MemoryPolicyConfigSchema = z.object({
  reserve_for_os_and_services: z.object({
    min_gb: NonNegative,
    fraction_of_total: Fraction,
  }),
  auto_prepare: z.object({
    fraction_of_usable_memory: Fraction,
    max_fraction_of_current_available: Fraction,
  }),
  manual_review: z.object({
    fraction_of_usable_memory: Fraction,
  }),
  pause_new_heavy_jobs_at_pressure: MemoryPressureSchema,
  stop_heavy_jobs_at_pressure: MemoryPressureSchema,
});

export const StoragePolicyConfigSchema = z.object({
  reserve_free: z.object({
    min_gb: NonNegative,
    fraction_of_total: Fraction,
  }),
  cache_budget: z.object({
    fraction_of_total: Fraction,
    max_fraction_of_current_free: Fraction,
    shares: z.object({
      model: Fraction,
      container: Fraction,
      media: Fraction,
    }),
  }),
});

export const ConcurrencyPolicyConfigSchema = z.object({
  concurrent_browser_collectors: z.number().int().positive(),
  concurrent_environment_builds: AutoOrNumberSchema,
  allow_local_model_while_building: AutoOrBooleanSchema,
});

/** Operator overrides. `null` means "not set". Values may only tighten. */
export const TighteningOverridesSchema = z.object({
  auto_prepare_memory_limit_gb: NonNegative.nullable(),
  manual_review_memory_limit_gb: NonNegative.nullable(),
  min_free_disk_gb: NonNegative.nullable(),
  total_cache_limit_gb: NonNegative.nullable(),
  concurrent_environment_builds: z.number().int().nonnegative().nullable(),
  allow_local_model_while_building: z.boolean().nullable(),
});

export const ResourcePolicyConfigSchema = z.object({
  mode: z.literal("adaptive"),
  derive_from: z.array(z.string()).min(1),
  memory: MemoryPolicyConfigSchema,
  storage: StoragePolicyConfigSchema,
  concurrency: ConcurrencyPolicyConfigSchema,
  tightening_overrides: TighteningOverridesSchema,
});

export const EffectiveResourcePolicySchema = z.object({
  hostProfileId: z.string().min(1),
  resolvedAt: IsoDateTimeSchema,
  memory: z.object({
    unifiedMemoryGb: NonNegative,
    reservedForSystemGb: NonNegative,
    usableMemoryGb: NonNegative,
    autoPrepareLimitGb: NonNegative,
    manualReviewLimitGb: NonNegative,
  }),
  storage: z.object({
    totalStorageGb: NonNegative,
    freeStorageGb: NonNegative,
    reservedFreeGb: NonNegative,
    cacheBudgetGb: NonNegative,
    cacheShares: z.object({
      modelGb: NonNegative,
      containerGb: NonNegative,
      mediaGb: NonNegative,
    }),
    belowReserve: z.boolean(),
  }),
  concurrency: z.object({
    browserCollectors: z.number().int().nonnegative(),
    environmentBuilds: z.number().int().nonnegative(),
    allowLocalModelWhileBuilding: z.boolean(),
  }),
  gates: z.object({
    acceptNewHeavyJobs: z.boolean(),
    stopRunningHeavyJobs: z.boolean(),
    reason: z.string().nullable(),
  }),
  /**
   * Which operator overrides actually took effect. Rendered as evidence in the UI
   * so a tightened limit is never mistaken for a hardware limit.
   */
  appliedTightenings: z.array(z.string()),
});

export type ResourcePolicyConfig = z.infer<typeof ResourcePolicyConfigSchema>;
export type TighteningOverrides = z.infer<typeof TighteningOverridesSchema>;
export type EffectiveResourcePolicy = z.infer<typeof EffectiveResourcePolicySchema>;
