import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { MediaRefSchema, SourceRefSchema } from "./common";
import { EvidenceRefSchema } from "./evidence";
import { AuthorRefSchema } from "./author";
import { OutboundLinkSchema } from "./links";

/**
 * One collected item, whole — the screen behind every "이 항목" link.
 *
 * The boards each show a *view* of an item shaped for their own question: Trends shows the
 * post, Style shows the picture, Music shows the candidates. This shows the item itself,
 * and it is deliberately board-agnostic, because Today links to items from all three and
 * `to_ai_card` was answering for a Reel as though it were a repository.
 *
 * Two properties:
 *
 * 1. **Nothing here is fetched.** Every field comes from a row already in the database.
 *    Opening this page cannot cause a request to a third party, which is the same promise
 *    the cards make.
 * 2. **Everything observed is shown, with where it came from.** The boards summarise;
 *    this does not. `evidence` carries every row attached to the item — the audio
 *    Instagram attributed, the text a recogniser read off a cover, what a repository
 *    declares — each with its own provenance, so a machine's reading is never presented
 *    as the thing it read (DESIGN.md §3.5).
 */
/**
 * Where an item sits — the four boards, or `none`.
 *
 * `none` is not a fifth board and the UI never draws it as one. It is the record of a
 * decision: something looked at this item and put it on no board. That is a different fact
 * from `board: null`, which means nobody has decided yet, and keeping the two apart is what
 * stops a corrected item from being re-sent to the classifier for an answer the user has
 * just overruled (`apps/api/.../enrich/classify.py::DECLINED`).
 *
 * Also the set of destinations `PATCH /api/items/{id}/board` accepts, which is why it is one
 * enum rather than two: a board a person can be moved onto but not moved off, or vice versa,
 * would be a control with a trap in it.
 */
export const ItemBoardSchema = z.enum(["trends", "style", "music", "places", "none"]);

export type ItemBoard = z.infer<typeof ItemBoardSchema>;

/**
 * The body of `PATCH /api/items/{id}/board`.
 *
 * One value, not a `changes` map like `SettingsPatchRequest`: there is one field to write
 * and a map of one key would be ceremony. Validated on the way *out* for the same reason
 * the settings patch is — the service answers a refused board with a 422 and the whole
 * refreshed item either way, so an unwritable value caught here is named instead of looking
 * like a change that had no effect.
 */
export const ItemBoardPatchRequestSchema = z.object({ board: ItemBoardSchema });

export type ItemBoardPatchRequest = z.infer<typeof ItemBoardPatchRequestSchema>;

export const ItemDetailModelSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  /**
   * Where this item sits, for the link back and for the board control.
   *
   * Null is a real and different answer from `"none"`: nothing has decided. Only reachable
   * by opening an item's URL directly, since an undecided item is on no board and on no
   * shelf — which is exactly what makes the two worth telling apart.
   */
  board: ItemBoardSchema.nullable(),
  title: z.string().min(1),
  /**
   * The post as written, in full and unshortened.
   *
   * Empty is a real state — a Reel whose caption is blank — and is rendered as such rather
   * than as a missing field.
   */
  body: z.string(),
  source: SourceRefSchema,
  /**
   * The cover, kept so a caller that only wants one image does not have to index.
   * Always `photos[0]` when there is one.
   */
  media: MediaRefSchema.nullable(),
  /**
   * Every photo the post carried, in the order the author posted them.
   *
   * The Style board went plural on 2026-08-09, and this route is where someone lands
   * *from* that board — showing one of five here is the surprise they hit the moment the
   * feature works. Empty when the post had no image, which is a real state.
   */
  photos: z.array(MediaRefSchema).default([]),
  tags: z.array(z.string()).default([]),
  links: z.array(OutboundLinkSchema).default([]),
  /**
   * Who posted it, and where they sell. Null until the profile has been read.
   *
   * `source.author` already carries the handle; this carries what the account says about
   * itself, which is where the purchase route lives.
   */
  author: AuthorRefSchema.nullable().default(null),
  /** Every observation attached to this item, newest kind first. May be empty. */
  evidence: z.array(EvidenceRefSchema).default([]),
  /** When the platform says the original was posted. Null where only a relative age shows. */
  sourcePublishedAt: IsoDateTimeSchema.nullable(),
  /** When an enricher last looked. Null means none has. */
  checkedAt: IsoDateTimeSchema.nullable(),
  firstSeenAt: IsoDateTimeSchema,
});

export type ItemDetailModel = z.infer<typeof ItemDetailModelSchema>;
