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
  "post",
  "product",
  "outfit",
]);

export const SourcePlatformSchema = z.enum([
  "github",
  "huggingface",
  "arxiv",
  "threads",
  "linkedin",
  "instagram",
  "web",
]);

export const SourceActionTypeSchema = z.enum(["star", "like", "save", "repost"]);

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

export const MediaRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["image", "video_frame", "og_image", "screenshot"]),
  src: z.string().min(1),
  width: z.number().positive().nullable().optional(),
  height: z.number().positive().nullable().optional(),
  alt: z.string(),
  blurDataUrl: z.string().nullable().optional(),
});

export const MoneySchema = z.object({
  amount: z.number(),
  currency: z.string().min(1),
});

export type ItemKind = z.infer<typeof ItemKindSchema>;
export type SourcePlatform = z.infer<typeof SourcePlatformSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
export type MediaRef = z.infer<typeof MediaRefSchema>;
export type Money = z.infer<typeof MoneySchema>;
