import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";

/**
 * Shared domain contract.
 * Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "Shared".
 * Field names and unions must stay identical to that document.
 */

export const ItemKindSchema = z.enum([
  "repo",
  "model",
  /**
   * Hugging Face returns `repo.type` as one of `model | dataset | space`, and the two
   * added here are exactly those. Folding a dataset into `model` would lose the
   * distinction the Browse filters key on.
   */
  "dataset",
  "space",
  "paper",
  "demo",
  "tool",
  /** A web page a person added by hand (`POST /api/items/manual`). */
  "post",
]);

/**
 * Where an item came from. `arxiv` and `web` are reached only by a link added by hand;
 * Instagram, Threads and LinkedIn were removed on 2026-09-28 (docs/DECISIONS.md).
 */
export const SourcePlatformSchema = z.enum(["github", "huggingface", "arxiv", "web"]);

/**
 * The act that put an item here.
 *
 * `upvote` is not a synonym for `like` (2026-09-28): a like is on a model, dataset or
 * Space, an upvote is on a paper, and a paper reached through a liked model's arXiv tag
 * keeps `like` because nobody upvoted it. Mirrors `db/models.py::ACTION_TYPES`.
 */
export const SourceActionTypeSchema = z.enum(["star", "like", "upvote"]);

export const SourceRefSchema = z.object({
  platform: SourcePlatformSchema,
  label: z.string().min(1),
  originalUrl: z.url(),
  author: z.string().nullable().optional(),
  actionType: SourceActionTypeSchema.nullable().optional(),
  /**
   * When Taste Inbox first observed the signal. Deliberately distinct from the
   * platform's own action time, which is often unavailable (CLAUDE.md §7).
   */
  firstSeenAt: IsoDateTimeSchema,
});

export type ItemKind = z.infer<typeof ItemKindSchema>;
export type SourcePlatform = z.infer<typeof SourcePlatformSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
