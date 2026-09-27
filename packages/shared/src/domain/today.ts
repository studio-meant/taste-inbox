import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { MediaRefSchema, SourcePlatformSchema, SourceRefSchema } from "./common";

/**
 * `GET /api/today` payload.
 *
 * `TodayPayload` itself is specified verbatim in PAGE_SPECIFICATIONS.md §5.2 "Required
 * payload". Its six sub-types — `DailyConnection`, `SavedSummary`, `QueueItem`,
 * `DaySummary`, `SuggestedQuery`, `SourceStatusSummary` — are **named but never defined
 * anywhere in the documents**. The shapes below are derived from the prose requirements
 * in the same section ("Required content", "Working Queue" allowed rows, "Partial
 * failure"), and each field carries the sentence it comes from.
 *
 * This is inference, not transcription. Reviewing it is worthwhile.
 */

/**
 * PAGE_SPECIFICATIONS.md §5.2 "Working Queue" — the allowed row kinds, in order.
 *
 * The last six were added with the research and trial runners (2026-09-28), after the
 * specification was changed first — the list is closed, and a seventh kind without a
 * document change is what `WorkingQueuePanel` forbids. `price_checking` has no producer in
 * this build and is kept so the inherited desktop bundle still parses.
 */
export const QueueItemKindSchema = z.enum([
  "environment_preparing",
  "environment_ready",
  "token_required",
  "review_required",
  "price_checking",
  "collector_auth",
  "research_running",
  "research_ready",
  /**
   * AI-Q is turning the user's question into a goal, criteria and a plan (2026-09-28).
   *
   * Its own kind because the queue had no way to say it: with research finished and a
   * suggestion on file, a planning pass in flight fell through to `approval_required` —
   * the row said "decide whether to run this" about a plan that was still being written.
   */
  "plan_running",
  "approval_required",
  "trial_running",
  "trial_ready",
  "trial_blocked",
]);

/** Which board a connection belongs to. */
/**
 * The Browse modes an item can belong to.
 *
 * `trends` was called `ai` until the board's contents argued otherwise: of 25 items only
 * six are runnable artifacts, and the rest are posts to keep up with. The Instagram
 * collection the user created is still named `ai` — that is their word for it and is
 * stored unchanged; this is the product's name for the board.
 *
 * `places` — saved restaurants, cafés and travel spots — holds nothing yet. It is in the
 * union anyway because the union is what every board-shaped surface reads: a value the
 * boards can produce but this enum cannot represent is a runtime error at the API boundary,
 * which is the coupling these schemas exist for.
 */
export const ItemDomainSchema = z.enum(["trends", "style", "music", "places", "none"]);

/**
 * An editorial lead or a related item on Today.
 *
 * Required content per §5.2: "editorial lead 1개 / related item 2–4개 / 관계 설명 1줄 /
 * source · domain · readiness signal / primary action 1개".
 */
export const DailyConnectionSchema = z.object({
  id: z.string().min(1),
  domain: ItemDomainSchema,
  title: z.string().min(1),
  /** The one-line summary of the item itself. */
  summary: z.string(),
  /** "관계 설명 1줄" — why this is connected to what the user already cares about. */
  relationNote: z.string().nullable(),
  source: SourceRefSchema,
  /**
   * Readiness signal. The domain status string (`ready_local`, `exact`, …); the web app
   * resolves it to a pill through its status registry, so this stays presentation-free.
   */
  readiness: z.string().nullable(),
  /** Route to open. §5.2 "Primary actions → lead item open". */
  href: z.string().min(1),
  media: MediaRefSchema.nullable(),
  /**
   * §5.2 Ranking: "낮은 confidence item은 lead보다 related slot에 둔다", so confidence
   * has to travel with the connection rather than be recomputed in the UI.
   */
  confidence: z.number().min(0).max(1).nullable(),
});

/** §5.2 "New Saved Items": count, board split, source icons, and recent previews. */
export const SavedSummarySchema = z.object({
  newItemCount: z.number().int().nonnegative(),
  aiCount: z.number().int().nonnegative(),
  styleCount: z.number().int().nonnegative(),
  /**
   * Today's music arrivals.
   *
   * Added because the product has three boards and the card was drawing two. The reference
   * has exactly two chips, and porting that shape meant every saved Reel landed in the
   * anonymous remainder the card computes as `newItemCount - ai - style` — present in the
   * meter, named nowhere.
   */
  musicCount: z.number().int().nonnegative(),
  /**
   * Today's places arrivals.
   *
   * The same reason `musicCount` exists: the card divides `newItemCount` into named boards
   * and computes the rest as `기타`. A board missing from the split is not absent from the
   * meter — it is drawn as an anonymous segment, which is how a saved Reel used to appear
   * before it was named. Zero while nothing is classified, and a zero draws no chip.
   */
  placesCount: z.number().int().nonnegative(),
  sources: z.array(SourcePlatformSchema),
  /**
   * Compatibility for an already-running desktop bundle. New surfaces use `previews`;
   * keeping the first one here lets the old bundle finish its session without rejecting
   * the response while the installed app is being replaced.
   */
  preview: MediaRefSchema.nullable(),
  /** Up to three real, locally cached items from the day the card counts, newest first. */
  previews: z.array(MediaRefSchema).max(3).default([]),
  href: z.string().min(1),
});

/** §5.2 "Working Queue": each row reads 상태 → 대상 → 다음 단계 또는 필요 행동. */
export const QueueItemSchema = z.object({
  id: z.string().min(1),
  kind: QueueItemKindSchema,
  /** 대상 — what the row is about. */
  target: z.string().min(1),
  /** 다음 단계 또는 필요 행동. */
  nextStep: z.string().min(1),
  href: z.string().min(1),
  /**
   * Present only for rows with steps to count: `environment_preparing`, `price_checking`,
   * `research_running` and `trial_running`. The last two are `JobStep` ordinals over the
   * total, read from the job — never an estimate of time remaining.
   */
  progress: z.number().min(0).max(1).nullable(),
});

/** §5.2 "Yesterday / timeline". */
export const DaySummarySchema = z.object({
  date: z.string().min(1),
  label: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
  highlights: z.array(
    z.object({
      id: z.string().min(1),
      domain: ItemDomainSchema,
      /**
       * Which account it came from.
       *
       * Carried so the cover can be tinted from the same per-platform colours the rail's
       * source dots already use, rather than every card wearing one identical blob.
       */
      platform: SourcePlatformSchema,
      title: z.string().min(1),
      meta: z.string(),
      href: z.string().min(1),
      /**
       * The item's own thumbnail, when one was cached.
       *
       * Null for GitHub, Threads and LinkedIn — the collectors cache Instagram media and
       * nothing else, so there is no picture of a starred repository to show. A generated
       * one would be a fake photo of a real thing, which is worse than an honest tint.
       */
      preview: z.string().min(1).nullable(),
    }),
  ),
});

/**
 * §11.6 SuggestedChip: at most three, each stating what it will do.
 * "`Surprise me`처럼 의미가 모호한 suggestion 금지" — hence the required `text`.
 */
export const SuggestedQuerySchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** Why this was suggested, shown on demand (DESIGN.md §11.6). */
  reason: z.string().nullable(),
});

/**
 * §5.2 "Partial failure" needs to say which collector succeeded and which was skipped,
 * so the summary is per-source rather than a single boolean.
 */
export const SourceCollectionStateSchema = z.enum([
  "collected",
  "skipped",
  "auth_required",
  "failed",
  "disabled",
]);

export const SourceStatusSummarySchema = z.object({
  sources: z.array(
    z.object({
      platform: SourcePlatformSchema,
      label: z.string().min(1),
      state: SourceCollectionStateSchema,
      collectedCount: z.number().int().nonnegative(),
      lastRunAt: IsoDateTimeSchema.nullable(),
    }),
  ),
});

export const TodayPayloadSchema = z.object({
  date: z.string().min(1),
  greeting: z.string(),
  counts: z.object({
    newItems: z.number().int().nonnegative(),
    readyActions: z.number().int().nonnegative(),
    attention: z.number().int().nonnegative(),
  }),
  leadConnection: DailyConnectionSchema.nullable(),
  relatedConnections: z.array(DailyConnectionSchema),
  savedSummary: SavedSummarySchema,
  workingQueue: z.array(QueueItemSchema),
  previousDays: z.array(DaySummarySchema),
  suggestedQueries: z.array(SuggestedQuerySchema),
  sourceStatusSummary: SourceStatusSummarySchema,
});

export type QueueItemKind = z.infer<typeof QueueItemKindSchema>;
export type ItemDomain = z.infer<typeof ItemDomainSchema>;
export type DailyConnection = z.infer<typeof DailyConnectionSchema>;
export type SavedSummary = z.infer<typeof SavedSummarySchema>;
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type DaySummary = z.infer<typeof DaySummarySchema>;
export type SuggestedQuery = z.infer<typeof SuggestedQuerySchema>;
export type SourceCollectionState = z.infer<typeof SourceCollectionStateSchema>;
export type SourceStatusSummary = z.infer<typeof SourceStatusSummarySchema>;
export type TodayPayload = z.infer<typeof TodayPayloadSchema>;
