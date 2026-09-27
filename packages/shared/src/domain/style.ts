import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { MediaRefSchema, SourceRefSchema } from "./common";
import { AuthorRefSchema } from "./author";
import { OutboundLinkSchema } from "./links";

/**
 * Source of truth: docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11 → "Style".
 *
 * **This card no longer claims anything about a product.** The board does not resolve
 * products — no shopping search, no image search, no brand and no price — on the user's
 * decision, so `brand`, `productName`, `matchGrade`, `currentPrice`, `observedPrice`,
 * `retailerCount` and `stockState` are gone. Each was a hardcoded null or `unknown` on all
 * 76 collected items, with no producer that would ever have filled it honestly.
 *
 * They are removed rather than left null, for the same reason the AI card's execution
 * fields were (docs/DECISIONS.md, 2026-08-09). A nullable `brand` still shapes the card: it
 * reserves a row, keeps a filter axis in the URL, and tells the next reader that an answer
 * is coming. None is. What a saved fashion post actually is — every photo it contained, its
 * caption, its hashtags, and where it points — is what the model now describes.
 */

/**
 * How confidently a product was matched. **Nothing on this card carries one any more.**
 *
 * Kept only because it is still imported outside this package: `lib/status/registry.ts`
 * builds `STYLE_MATCH` from it, `lib/filters/board-filters.ts` parses both unions out of
 * the URL, and both have their own tests. Deleting the union here would break those files
 * rather than the ones this change owns, so it stays until they are removed together.
 */
export const StyleMatchGradeSchema = z.enum(["exact", "likely", "similar", "unknown"]);

/** Whether a resolved product was buyable. Unused by this card, and kept for the same reason. */
export const StyleStockStateSchema = z.enum(["available", "partial", "sold_out", "unknown"]);

export const StyleItemCardModelSchema = z.object({
  id: z.string().min(1),
  source: SourceRefSchema,
  /**
   * Every photo the post contained, in the order the author posted them.
   *
   * The array was always plural and always held exactly one entry, because the collector
   * read a carousel only to find its cover and threw the rest away (`instagram/capture.py`).
   * A single image or a Reel still yields one entry, so the gallery has no carousel case
   * and an empty array stays a normal state — some items have no usable photo at all.
   */
  media: z.array(MediaRefSchema),
  /**
   * A short name for the card: the caption's lead line, or a plain fallback.
   *
   * Not a description of the outfit — nothing has looked at the photo. It exists so the
   * card has an accessible name that is not the whole caption.
   */
  descriptor: z.string(),
  /**
   * The post's text, whole.
   *
   * Whole because shortening is the card's job and the card can undo it. Untrusted
   * third-party text: rendered, never parsed as markup and never used as an instruction.
   */
  caption: z.string(),
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
   * Usually empty here: a saved fashion post carries only whatever the caption happened to
   * link. Present anyway so the affordance is the same on every board (docs/DECISIONS.md,
   * 2026-08-09 — "Every card has somewhere to go").
   */
  links: z.array(OutboundLinkSchema).default([]),
  /**
   * Who posted it, and where they sell. Null until the profile has been read.
   *
   * `source.author` already carries the handle; this carries what the account says about
   * itself, which is where the purchase route lives.
   */
  author: AuthorRefSchema.nullable().default(null),
});

export type StyleMatchGrade = z.infer<typeof StyleMatchGradeSchema>;
export type StyleStockState = z.infer<typeof StyleStockStateSchema>;
export type StyleItemCardModel = z.infer<typeof StyleItemCardModelSchema>;
