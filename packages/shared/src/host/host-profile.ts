import { z } from "zod";

/**
 * Runtime hardware contract.
 *
 * Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 (Type model → Shared)
 * and docs/SYSTEM_ARCHITECTURE.md "Runtime hardware adaptation".
 *
 * No specific Mac model, chip, or capacity is encoded anywhere in this module.
 * Every value is produced by the runtime detector or by a sanitized fixture.
 */

/** ISO-8601 instant, e.g. `2026-08-08T06:31:00Z`. */
export const IsoDateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-8601 date-time string",
});

export const ArchitectureSchema = z.literal("arm64");

export const MemoryPressureSchema = z.enum(["normal", "warning", "critical", "unknown"]);

/**
 * The profile shape exposed to the frontend. Matches the documented interface
 * field-for-field; do not add fields here without updating the architecture doc.
 */
export const HostProfileSchema = z.object({
  id: z.string().min(1),
  deviceModel: z.string().min(1),
  chip: z.string().min(1),
  architecture: ArchitectureSchema,
  unifiedMemoryGb: z.number().positive(),
  totalStorageGb: z.number().positive(),
  freeStorageGb: z.number().nonnegative(),
  memoryPressure: MemoryPressureSchema,
  detectedAt: IsoDateTimeSchema,
});

/**
 * Backend-internal superset.
 *
 * `resource-policy.example.yaml` uses `max_fraction_of_current_available`, which
 * needs currently-available memory. That signal is volatile and host-local, so it
 * stays inside the service and is never part of the frontend DTO.
 */
export const DetectedHostProfileSchema = HostProfileSchema.extend({
  availableMemoryGb: z.number().nonnegative(),
});

export type Architecture = z.infer<typeof ArchitectureSchema>;
export type MemoryPressure = z.infer<typeof MemoryPressureSchema>;
export type HostProfile = z.infer<typeof HostProfileSchema>;
export type DetectedHostProfile = z.infer<typeof DetectedHostProfileSchema>;

/** Narrow an internal detection result down to the documented public DTO. */
export function toHostProfileDto(detected: DetectedHostProfile): HostProfile {
  return HostProfileSchema.parse(detected);
}

/** Pressure levels that must block newly queued heavy work. */
export const PRESSURE_PAUSING_NEW_HEAVY_JOBS: readonly MemoryPressure[] = ["warning", "critical"];

/** Pressure levels that must stop heavy work already running. */
export const PRESSURE_STOPPING_HEAVY_JOBS: readonly MemoryPressure[] = ["critical"];
