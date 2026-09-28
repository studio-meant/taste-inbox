import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { ItemKindSchema, SourcePlatformSchema, SourceRefSchema } from "./common";

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
 * Every kind here has a producer (`api/today.py::_working_queue`). The inherited six —
 * environment preparing/ready, token and review required, price checking and collector
 * login — went on 2026-09-28 with the sandbox runner, the Style board and the browser
 * collectors that produced them. The list is closed: a kind without a document change is
 * what `WorkingQueuePanel` forbids.
 */
export const QueueItemKindSchema = z.enum([
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

/**
 * An editorial lead or a related item on Today.
 *
 * Required content per §5.2: "editorial lead 1개 / related item 2–4개 / 관계 설명 1줄 /
 * source · domain · readiness signal / primary action 1개".
 */
export const DailyConnectionSchema = z.object({
  id: z.string().min(1),
  kind: ItemKindSchema,
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
  /**
   * §5.2 Ranking: "낮은 confidence item은 lead보다 related slot에 둔다", so confidence
   * has to travel with the connection rather than be recomputed in the UI.
   */
  confidence: z.number().min(0).max(1).nullable(),
});

/** §5.2 "New Saved Items" — the card Today calls New signals. */
export const SavedSummarySchema = z.object({
  newItemCount: z.number().int().nonnegative(),
  /**
   * Today's arrivals by item kind (`repo`, `paper`, `dataset`, `space`, …), largest first —
   * the same axis the Inbox rail counts, so a chip is one click from the list it counts.
   */
  kindCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  sources: z.array(SourcePlatformSchema),
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
   * Present only for rows with steps to count — `research_running`, `plan_running` and
   * `trial_running`: `JobStep` ordinals over the total, read from the job, never an
   * estimate of time remaining.
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
      kind: ItemKindSchema,
      /**
       * Which account it came from, so the card can be tinted from the same per-platform
       * colours the rail's source dots use. There is no picture of a starred repository,
       * and a generated one would be a fake photo of a real thing.
       */
      platform: SourcePlatformSchema,
      title: z.string().min(1),
      meta: z.string(),
      href: z.string().min(1),
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
export type DailyConnection = z.infer<typeof DailyConnectionSchema>;
export type SavedSummary = z.infer<typeof SavedSummarySchema>;
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type DaySummary = z.infer<typeof DaySummarySchema>;
export type SuggestedQuery = z.infer<typeof SuggestedQuerySchema>;
export type SourceCollectionState = z.infer<typeof SourceCollectionStateSchema>;
export type SourceStatusSummary = z.infer<typeof SourceStatusSummarySchema>;
export type TodayPayload = z.infer<typeof TodayPayloadSchema>;
