import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { SourceRefSchema } from "./common";
import { EvidenceRefSchema } from "./evidence";
import { OutboundLinkSchema } from "./links";

/**
 * One collected item, whole — the screen behind every "이 항목" link.
 *
 * Two properties:
 *
 * 1. **Nothing here is fetched.** Every field comes from a row already in the database.
 *    Opening this page cannot cause a request to a third party, which is the same promise
 *    the cards make.
 * 2. **Everything observed is shown, with where it came from.** The card summarises; this
 *    does not. `evidence` carries every row attached to the item — what a paper page names,
 *    what a repository declares, what research and a trial found — each with its own
 *    provenance, so a machine's reading is never presented as the thing it read
 *    (DESIGN.md §3.5).
 */
export const ItemDetailModelSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  /** The text as written, in full and unshortened. Empty is a real state. */
  body: z.string(),
  source: SourceRefSchema,
  tags: z.array(z.string()).default([]),
  links: z.array(OutboundLinkSchema).default([]),
  /** Every observation attached to this item, grouped by kind. May be empty. */
  evidence: z.array(EvidenceRefSchema).default([]),
  /** When the platform says the original was published. */
  sourcePublishedAt: IsoDateTimeSchema.nullable(),
  /** When an enricher last looked. Null means none has. */
  checkedAt: IsoDateTimeSchema.nullable(),
  firstSeenAt: IsoDateTimeSchema,
});

export type ItemDetailModel = z.infer<typeof ItemDetailModelSchema>;
