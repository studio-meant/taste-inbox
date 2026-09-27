import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";

/** Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "Evidence". */

/**
 * Where a piece of evidence came from.
 *
 * The first three say what *kind* of claim the row is — this product's observation, its
 * inference, or somebody else's conclusion. The four added on 2026-09-28 say *who made
 * it*, because the screens now show claims from three different machines and a reader
 * has to be able to tell them apart: the Hub stating a paper's repository, an AI-Q
 * research citation, something the sandbox actually observed while running the code, and
 * an endpoint the network policy refused.
 *
 * `policy` is the one that could not exist before. A blocked egress attempt is not a log
 * line here — it is a finding the user is shown.
 */
export const EvidenceProvenanceSchema = z.enum([
  "fact",
  "inference",
  "external",
  "huggingface",
  "aiq",
  "sandbox",
  "policy",
]);

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
