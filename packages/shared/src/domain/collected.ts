import { z } from "zod";

/**
 * A raw collected item, exactly as the browser collector emits it.
 *
 * This is the cross-language contract with
 * `services/collectors/.../instagram/capture.py::CapturedItem`. It is deliberately
 * *pre-enrichment*: it carries what was observed and nothing that was inferred. No
 * product identity, no track identity, no compatibility verdict — those arrive later,
 * from enrichers, and keeping them out of this shape is what stops an observation from
 * being mistaken for a conclusion (`DESIGN.md` §3.5).
 *
 * Field names are snake_case because they cross from Python unchanged; mapping to the
 * camelCase view models happens in one place, in the web app's mappers.
 */

export const CollectedDomainSchema = z.enum(["ai", "music", "fashion"]);

export const CollectedItemSchema = z.object({
  /** Instagram shortcode. The canonical identity, and what dedupe keys on. */
  code: z.string().min(1),
  media_type: z.string(),
  product_type: z.string().nullable(),
  /** Platform timestamp, seconds. Distinct from when Taste Inbox first saw it. */
  taken_at: z.number().int().nullable(),
  owner: z.string().nullable(),
  caption: z.string(),
  accessibility_caption: z.string().nullable(),
  audio_title: z.string().nullable(),
  audio_artist: z.string().nullable(),
  is_original_audio: z.boolean().nullable(),
  product_tag_count: z.number().int().nonnegative(),
  user_tag_count: z.number().int().nonnegative(),
  source_endpoint: z.string().default(""),
  /**
   * Signed CDN URL. Expires within days, so it is a fetch hint rather than a durable
   * reference — Phase 2's media cache is what makes an item outlive its source.
   */
  thumbnail_url: z.string().nullable().default(null),
  thumbnail_width: z.number().int().positive().nullable().default(null),
  thumbnail_height: z.number().int().positive().nullable().default(null),
});

export const CollectedItemsSchema = z.array(CollectedItemSchema);

export type CollectedDomain = z.infer<typeof CollectedDomainSchema>;
export type CollectedItem = z.infer<typeof CollectedItemSchema>;

/** `clips` is Instagram's product type for a Reel. */
export function isReel(item: CollectedItem): boolean {
  return item.product_type === "clips";
}

export function permalinkOf(item: CollectedItem): string {
  return `https://www.instagram.com/${isReel(item) ? "reel" : "p"}/${item.code}/`;
}

/**
 * Hashtags, in caption order and deduped.
 *
 * Useful as evidence — `#내돈내산` on a fashion post says something a caption summary
 * would lose — and cheap enough to derive on read rather than store.
 */
export function hashtagsOf(item: CollectedItem): string[] {
  const found = item.caption.match(/#[^\s#·,()[\]]+/g) ?? [];
  return [...new Set(found)];
}

/**
 * The caption with its trailing hashtag block removed.
 *
 * Korean Instagram captions routinely end in twenty hashtags; showing them as body copy
 * buries the sentence that actually says what the post is.
 */
export function captionBodyOf(item: CollectedItem): string {
  return item.caption.replace(/(?:^|\n)[^\n]*?(?:#[^\s#]+\s*){3,}$/u, "").trim();
}
