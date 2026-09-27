import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";

/**
 * What one sandbox run left behind.
 *
 * The shape is small because the screen's job is not to replay the run — it is to say
 * what happened, what the agent reported, and **what the boundary refused**. The last of
 * those is the part no other stage could have produced.
 */

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
  observedAt: IsoDateTimeSchema.nullable(),
  /** What the agent said it did. Truncated at the API boundary, never rewritten. */
  transcript: z.string().nullable(),
  blocked: z.array(z.string()),
  /** File names the run left in its working directory — evidence something ran. */
  artifacts: z.array(z.string()),
});

/** `POST /api/trials` response: the run, plus the boundary it ran under. */
export const TrialRunResponseSchema = z.object({
  jobId: z.string().min(1),
  trialId: z.string().min(1),
  state: z.enum(["succeeded", "partially_succeeded", "failed", "blocked"]),
  sandbox: z.string().min(1),
  artifacts: z.array(z.string()),
  error: z.string().nullable(),
  result: z
    .object({
      ok: z.boolean(),
      stopReason: z.string().nullable(),
      toolCalls: z.number().int().nonnegative(),
      toolFailures: z.number().int().nonnegative(),
      tools: z.array(z.string()),
      finalText: z.string(),
      model: z.string().nullable(),
      blocked: z.array(z.object({ host: z.string().nullable(), line: z.string() })),
    })
    .nullable(),
});

export type TrialResult = z.infer<typeof TrialResultSchema>;
export type TrialRunResponse = z.infer<typeof TrialRunResponseSchema>;
