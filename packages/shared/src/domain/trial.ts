import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";

/**
 * What one sandbox run left behind.
 *
 * The shape is small because the screen's job is not to replay the run — it is to say
 * what happened, what the agent reported, and **what the boundary refused**. The last of
 * those is the part no other stage could have produced.
 */

/** One refused connection: the host, the program that tried it, how often, and why. */
export const TrialDenialSchema = z.object({
  host: z.string().min(1),
  binary: z.string().nullable(),
  count: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
});

/**
 * `GET /api/trials/{itemId}` — the last trial on one item, or null.
 *
 * `blocked` holds hosts the network policy stopped the code from reaching while it ran.
 * They are findings, not log lines: *the repository you starred tried to reach this host
 * while installing* is an observation only the sandbox could make, and the card draws it
 * as evidence with its own provenance rather than hiding it in a transcript.
 */
export const TrialResultSchema = z.object({
  /** `exit=… · tools=… · failures=… · stop=… · sandbox=…`, as the run reported it. */
  result: z.string().nullable(),
  /** The same line split into its pairs, so the screen can draw them apart. */
  facts: z.record(z.string(), z.string()).default({}),
  observedAt: IsoDateTimeSchema.nullable(),
  /** What the agent said it did. Truncated at the API boundary, never rewritten. */
  transcript: z.string().nullable(),
  /**
   * The end of what a run that did not succeed printed, colour codes removed. The reason a
   * CLI stopped is usually only there — without it a failure is an exit code and nothing.
   */
  errorOutput: z.string().nullable(),
  blocked: z.array(z.string()),
  /**
   * The same refusals with who tried and why, read from OpenShell's own log for the run's
   * window. `binary`/`count`/`reason` are null for a refusal known only from the agent's
   * streams, which name the host and nothing else.
   */
  denials: z.array(TrialDenialSchema),
  /** File names the run left in its working directory — evidence something ran. */
  artifacts: z.array(z.string()),
});

/**
 * `POST /api/research` and `POST /api/trials` — `202`, a queued job.
 *
 * Both answer at once and run in the background; the job is followed through
 * `GET /api/jobs/{id}`. Every refusal (no approval, no research yet, the boundary not
 * ready, a non-local AI-Q backend) comes back as a typed error *instead* of a job, so a
 * job id always means the run was actually started.
 */
export const JobStartResponseSchema = z.object({
  jobId: z.string().min(1),
  state: z.literal("queued"),
});

export const ResearchStartResponseSchema = JobStartResponseSchema.extend({
  /** Which AI-Q backend the question goes to. Named before sending (aiq-research skill). */
  serverUrl: z.string().min(1),
  target: z.string().min(1),
});

/**
 * `POST /api/lab/questions` — the question, and the planning pass AI-Q runs on it.
 *
 * The question comes back so the screen shows what the service actually stored: it is
 * trimmed there, and a user who typed trailing whitespace should see what was sent.
 */
export const QuestionStartResponseSchema = JobStartResponseSchema.extend({
  question: z.string().min(1),
  serverUrl: z.string().min(1),
  target: z.string().min(1),
});

export const TrialStartResponseSchema = JobStartResponseSchema.extend({
  /** The boundary the trial was checked against, as read at the moment it was approved. */
  policy: z.object({
    sandbox: z.string().min(1),
    ready: z.boolean(),
    busy: z.boolean(),
    policies: z.array(z.string()),
    missingPresets: z.array(z.string()),
    refusedHosts: z.array(z.string()),
    satisfied: z.boolean(),
    reason: z.string().nullable(),
  }),
});

export type TrialDenial = z.infer<typeof TrialDenialSchema>;
export type TrialResult = z.infer<typeof TrialResultSchema>;
export type JobStartResponse = z.infer<typeof JobStartResponseSchema>;
export type ResearchStartResponse = z.infer<typeof ResearchStartResponseSchema>;
export type QuestionStartResponse = z.infer<typeof QuestionStartResponseSchema>;
export type TrialStartResponse = z.infer<typeof TrialStartResponseSchema>;
