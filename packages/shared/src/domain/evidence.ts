import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";

/** Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "Evidence". */

export const EvidenceProvenanceSchema = z.enum(["fact", "inference", "external"]);

export const EvidenceRefSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  /** Separating fact from inference is a trust requirement (DESIGN.md §3.5). */
  provenance: EvidenceProvenanceSchema,
  sourceUrl: z.url().nullable().optional(),
  observedAt: IsoDateTimeSchema.nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
