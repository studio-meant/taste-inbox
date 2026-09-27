import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { MediaRefSchema, SourceRefSchema } from "./common";
import { OutboundLinkSchema } from "./links";

/**
 * Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "AI" (the Trends board).
 *
 * **This card no longer claims anything about running code.** The sandbox runner was
 * removed on the user's decision (docs/DECISIONS.md, 2026-08-09), and with it went
 * `status`, `peakMemoryGb`, `diskGb`, `compatibility`, `supportsArm64`, `requiresCuda`,
 * `requiredSecrets` and `whyItMatters` — every field that existed to answer "will this run
 * on this Mac".
 *
 * They are removed rather than left null on purpose. A nullable `status` still shapes the
 * card: it reserves a pill, keeps a filter axis in the URL, and tells the next reader that
 * an answer is coming. Nothing is coming. What the board holds is a collected post, its
 * text, its hashtags and the places it points — and the model now says exactly that.
 *
 * What a repository *declares about itself* is still read and still stored as evidence
 * (`enrich/github.py`). That is an observation about a README, not a promise about this
 * machine, which is why it survived and the verdict did not.
 */

/**
 * What the item actually is.
 *
 * `post` covers an item collected from a social platform that talks about AI without
 * being a project — an Instagram save, a Threads repost. Kept now that nothing is
 * runnable, because it still separates "someone's repository" from "someone's post about
 * a repository", which is the difference between the two links on the card.
 */
export const AIItemKindSchema = z.enum(["repo", "model", "paper", "demo", "tool", "post"]);

export const AIItemCardModelSchema = z.object({
  id: z.string().min(1),
  kind: AIItemKindSchema,
  title: z.string().min(1),
  source: SourceRefSchema,
  /** The post in full. Shortening is the card's job, and the card can undo it. */
  summary: z.string(),
  /** When an enricher last looked. Null means none has. */
  checkedAt: IsoDateTimeSchema.nullable(),
  /**
   * Hashtags as the author wrote them, `#` included.
   *
   * An observation, not an inference: the strings are lifted from the caption unchanged.
   * On an unenriched board they carry more signal than anything else on the card, which
   * is why they are part of the item rather than something the view derives.
   */
  tags: z.array(z.string()).default([]),
  /**
   * Everywhere else this item points, one click away.
   *
   * The board is mostly Threads and LinkedIn posts whose subject lives on another domain,
   * so `source.originalUrl` alone leaves the actual repository or paper a hop further out.
   * Empty is normal — most items mention nothing.
   */
  links: z.array(OutboundLinkSchema).default([]),
  preview: MediaRefSchema.nullable(),
});

export type AIItemKind = z.infer<typeof AIItemKindSchema>;
export type AIItemCardModel = z.infer<typeof AIItemCardModelSchema>;
