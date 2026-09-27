import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { JobStateSchema, JobStepStateSchema } from "./job";

/**
 * `GET /api/accounts` — the GitHub and Hugging Face accounts this Mac collects.
 *
 * An account is a name (`github.com/ohsuz` → `ohsuz`), not a login: stars, likes and paper
 * upvotes are all public. A token is optional and lives in `.env`; this contract says only
 * whether one is set, never its value (`api/accounts.py`).
 */
export const AccountPlatformSchema = z.enum(["github", "huggingface"]);

export const AccountSurfaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  lastRunAt: IsoDateTimeSchema.nullable(),
  /** `ok`, `failed`, `rate_limited`, `empty`, … — as the last run recorded it. */
  outcome: z.string().nullable(),
  stoppedBecause: z.string().nullable(),
  itemsSeen: z.number().int().nonnegative().nullable(),
});

export const AccountSchema = z.object({
  platform: AccountPlatformSchema,
  label: z.string().min(1),
  handle: z.string().nullable(),
  profileUrl: z.string().nullable(),
  tokenEnv: z.string().min(1),
  tokenConfigured: z.boolean(),
  tokenEffect: z.string(),
  itemCount: z.number().int().nonnegative(),
  surfaces: z.array(AccountSurfaceSchema),
  /** The newest collection job for this platform, running or finished. */
  job: z
    .object({
      id: z.string().min(1),
      state: JobStateSchema,
      startedAt: IsoDateTimeSchema.nullable(),
      finishedAt: IsoDateTimeSchema.nullable(),
      steps: z.array(
        z.object({
          label: z.string().min(1),
          state: JobStepStateSchema,
          message: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});

export const AccountsResponseSchema = z.object({ accounts: z.array(AccountSchema) });

export const AccountConnectResponseSchema = AccountsResponseSchema.extend({
  handle: z.string().min(1),
  changed: z.boolean(),
  /** Null when another collection was already running; this one waits for the schedule. */
  jobId: z.string().nullable(),
});

export type AccountPlatform = z.infer<typeof AccountPlatformSchema>;
export type AccountSurface = z.infer<typeof AccountSurfaceSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type AccountsResponse = z.infer<typeof AccountsResponseSchema>;
export type AccountConnectResponse = z.infer<typeof AccountConnectResponseSchema>;
