import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { ItemKindSchema, SourcePlatformSchema } from "./common";
import { JobStateSchema, JobStepStateSchema } from "./job";
import { TrialResultSchema } from "./trial";

/**
 * `GET /api/focus/{itemId}` — the Focus Canvas payload.
 *
 * One request rather than four, because the screen is a single statement about a single
 * item. Four round trips would let it render in inconsistent halves: research from one
 * moment beside a trial from another.
 *
 * **Every section is nullable, and absence is a state the screen has a design for.** An
 * item with no research is not an error; it is an item nobody has researched yet. What
 * this payload must never do is fill a gap with something plausible — the inherited
 * `/api/today` returns an empty working queue rather than inventing activity, and this is
 * the same rule on a different screen.
 */

/** One saved item that shares ground with the subject, and the words it shares. */
export const TasteNeighbourSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  kind: ItemKindSchema,
  platform: SourcePlatformSchema,
  canonicalUrl: z.url(),
  /** Why it is here, in the user's own collected words. Never a computed similarity. */
  sharedTerms: z.array(z.string()).min(1),
  actionAt: IsoDateTimeSchema.nullable(),
});

export const TasteContextSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  kind: ItemKindSchema,
  platform: SourcePlatformSchema,
  canonicalUrl: z.url(),
  itemTerms: z.array(z.string()),
  /** What recurs across the library, with how many items carry each. */
  recurringTerms: z.array(
    z.object({ term: z.string().min(1), itemCount: z.number().int().positive() }),
  ),
  sharedTerms: z.array(z.string()),
  neighbours: z.array(TasteNeighbourSchema),
  recentKinds: z.record(z.string(), z.number().int().nonnegative()),
  recentTotal: z.number().int().nonnegative(),
  /** Facts the source itself stated about the subject. */
  stated: z.array(
    z.object({
      type: z.string().min(1),
      label: z.string(),
      value: z.string(),
      sourceUrl: z.string().nullable(),
      provenance: z.string(),
      confidence: z.number().nullable(),
    }),
  ),
  evidenceItemIds: z.array(z.string()),
  /**
   * False when the library connects to nothing here.
   *
   * Carried rather than derived in the UI because the research brief is told the same
   * thing, and the screen and the question must not disagree about whether a connection
   * exists.
   */
  grounded: z.boolean(),
});

/** One arm of a paper bundle. */
const BranchSchema = z.object({
  value: z.string().min(1),
  sourceUrl: z.string().nullable(),
  confidence: z.number().nullable(),
});

/**
 * Paper → Code · Model · Dataset · Demo, as the Hub stated it.
 *
 * `repoProvenance` is the distinction the whole bundle exists to preserve:
 * `author-linked` means a person linked the repository, `auto-linked` means the Hub
 * matched it. They must never be drawn identically — a guess presented as an official
 * implementation is exactly the failure `DESIGN.md` §3.5 forbids.
 */
export const PaperBundleSchema = z.object({
  repo: BranchSchema.nullable(),
  repoProvenance: z.enum(["author-linked", "auto-linked"]).nullable(),
  projectPage: BranchSchema.nullable(),
  models: z.array(BranchSchema),
  datasets: z.array(BranchSchema),
  spaces: z.array(BranchSchema),
  /** The honest sizes. `linked*` is a preview; a paper can be cited by thousands. */
  totals: z.record(z.string(), z.number().int().nonnegative()),
});

export const ResearchReportSchema = z.object({
  /** Verbatim, citations and source URLs intact. */
  report: z.string().min(1),
  observedAt: IsoDateTimeSchema.nullable(),
  sourceUrl: z.string().nullable(),
  /** What left the machine, stored so the send stays reviewable. */
  brief: z.string().nullable(),
  headline: z.string().nullable(),
});

export const TrialPlanSchema = z.object({
  subjectId: z.string().min(1),
  subjectUrl: z.url(),
  planText: z.string().min(1),
  successCriteria: z.string().min(1),
  requiredHosts: z.array(z.string()),
  /**
   * Hosts the report named that are **not** opened.
   *
   * Shown rather than dropped: a research report is web-derived text and cannot widen the
   * boundary by mentioning a domain, and the user is told which domains it mentioned.
   */
  refusedHosts: z.array(z.string()),
  commandsSeen: z.array(z.string()),
});

export const SuggestedActionSchema = z.object({
  subjectId: z.string().min(1),
  headline: z.string().min(1),
  rationale: z.string(),
  /** False means the report gave no concrete step — the card must not offer `Try safely`. */
  actionable: z.boolean(),
  plan: TrialPlanSchema,
});

/**
 * One network policy as the sandbox enforces it: hosts *and* the binaries allowed to reach
 * them. The pairing is the finding of feasibility F4 — `curl` was refused on a host the
 * `huggingface` policy opens, because that policy lists `python3` and `node`, not `curl`.
 */
export const PolicyEndpointsSchema = z.object({
  policy: z.string().min(1),
  hosts: z.array(z.string()),
  binaries: z.array(z.string()),
});

/** What the sandbox is, as read at the moment the person is looking. */
export const SandboxBoundarySchema = z.object({
  sandbox: z.string().min(1),
  ready: z.boolean(),
  /** Another trial holds the host lock. A wait, not a missing boundary. */
  busy: z.boolean(),
  policies: z.array(z.string()),
  /** Presets a trial needs that are not applied. Empty while busy: the lock hides them. */
  missingPresets: z.array(z.string()),
  /** Empty when the ledger could not be read — drawn as unavailable, never guessed. */
  endpoints: z.array(PolicyEndpointsSchema),
  /** Why it is not ready, in the runtime's own words (`docker_unreachable: …`). */
  reason: z.string().nullable(),
});

/**
 * The newest research or trial job on the item.
 *
 * The evidence says what the last *finished* run found; this says what is happening now,
 * or how the last attempt ended. A failed research run leaves the older report in place,
 * and the screen has to be able to say both.
 */
export const FocusJobSchema = z.object({
  id: z.string().min(1),
  state: JobStateSchema,
  currentStep: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  steps: z.array(
    z.object({
      label: z.string().min(1),
      state: JobStepStateSchema,
      message: z.string().nullable(),
    }),
  ),
});

/**
 * What a research run would send, and where — shown *before* anything is sent.
 *
 * `CLAUDE.md` §3: the screen says what leaves the machine and to where, rather than
 * claiming nothing does. `query` is the exact brief (it is deterministic); `error` is why
 * the run would refuse — an unset `AIQ_SERVER_URL`, or a non-local one that is not https.
 */
export const OutboundSchema = z.object({
  serverUrl: z.string().nullable(),
  /** True when the backend is on this machine. Null when there is no usable URL. */
  local: z.boolean().nullable(),
  query: z.string().nullable(),
  error: z.string().nullable(),
});

export const FocusPayloadSchema = z.object({
  item: z.object({
    id: z.string().min(1),
    kind: ItemKindSchema,
    platform: SourcePlatformSchema,
    title: z.string().min(1),
    summary: z.string().nullable(),
    canonicalUrl: z.url(),
    author: z.string().nullable(),
    /** When the user starred or liked it. The API collectors are why this is not null. */
    actionAt: IsoDateTimeSchema.nullable(),
    firstSeenAt: IsoDateTimeSchema,
  }),
  context: TasteContextSchema.nullable(),
  outbound: OutboundSchema,
  bundle: PaperBundleSchema.nullable(),
  research: ResearchReportSchema.nullable(),
  suggestion: SuggestedActionSchema.nullable(),
  trial: TrialResultSchema.nullable(),
  jobs: z.object({
    research: FocusJobSchema.nullable(),
    trial: FocusJobSchema.nullable(),
  }),
  boundary: SandboxBoundarySchema,
});

export type TasteNeighbour = z.infer<typeof TasteNeighbourSchema>;
export type TasteContext = z.infer<typeof TasteContextSchema>;
export type PaperBundle = z.infer<typeof PaperBundleSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type TrialPlan = z.infer<typeof TrialPlanSchema>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type SandboxBoundary = z.infer<typeof SandboxBoundarySchema>;
export type PolicyEndpoints = z.infer<typeof PolicyEndpointsSchema>;
export type FocusJob = z.infer<typeof FocusJobSchema>;
export type Outbound = z.infer<typeof OutboundSchema>;
export type FocusPayload = z.infer<typeof FocusPayloadSchema>;
