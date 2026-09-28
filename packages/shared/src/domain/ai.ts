import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { SourceRefSchema } from "./common";
import { OutboundLinkSchema } from "./links";

/**
 * One Inbox card. Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "AI".
 *
 * **This card no longer claims anything about running code.** The sandbox runner was
 * removed on the user's decision (docs/DECISIONS.md, 2026-08-09), and with it went
 * `status`, `peakMemoryGb`, `diskGb`, `compatibility`, `supportsArm64`, `requiresCuda`,
 * `requiredSecrets` and `whyItMatters` — every field that existed to answer "will this run
 * on this Mac".
 *
 * They are removed rather than left null on purpose. A nullable `status` still shapes the
 * card: it reserves a pill, keeps a filter axis in the URL, and tells the next reader that
 * an answer is coming. Nothing is coming. What the Inbox holds is a collected item, its
 * text, its topics and the places it points — and the model now says exactly that.
 *
 * What a repository *declares about itself* is still read and still stored as evidence
 * (`enrich/github.py`). That is an observation about a README, not a promise about this
 * machine, which is why it survived and the verdict did not.
 */

/**
 * What the item actually is.
 *
 * `dataset` and `space` since 2026-09-28: a Hugging Face like is a model, a dataset or a
 * Space (`repo.type`). Folding them into `model` would lose the distinction the kind filter
 * exists for. `post` is a web page a person added by hand.
 */
export const AIItemKindSchema = z.enum([
  "repo",
  "model",
  "dataset",
  "space",
  "paper",
  "demo",
  "tool",
  "post",
]);

export const AIItemCardModelSchema = z.object({
  id: z.string().min(1),
  kind: AIItemKindSchema,
  title: z.string().min(1),
  source: SourceRefSchema,
  /** The description or abstract in full. Shortening is the card's job, and it can undo it. */
  summary: z.string(),
  /** When an enricher last looked. Null means none has. */
  checkedAt: IsoDateTimeSchema.nullable(),
  /**
   * Topics as the source wrote them — a repository's topics, a model card's tags.
   *
   * An observation, not an inference: the strings are lifted unchanged.
   */
  tags: z.array(z.string()).default([]),
  /**
   * Everywhere else this item points, one click away — a paper's code, a repository's
   * homepage. Empty is normal.
   */
  links: z.array(OutboundLinkSchema).default([]),
});

export type AIItemKind = z.infer<typeof AIItemKindSchema>;
export type AIItemCardModel = z.infer<typeof AIItemCardModelSchema>;
