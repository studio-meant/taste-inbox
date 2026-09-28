import { z } from "zod";
import { AccountSchema } from "./accounts";

/**
 * `GET /api/profile` — whose workspace this is, and whether first-run setup is done.
 *
 * The name is a local greeting, never sent anywhere (`api/profile.py`). `onboarded` is true
 * once a name is stored; until then every workspace route sends the person to `/onboarding`.
 */
export const ProfileSchema = z.object({
  name: z.string().min(1).nullable(),
  onboarded: z.boolean(),
});

/**
 * `POST /api/onboarding` — the first-run answers, validated whole by the service.
 *
 * `intervalHours` is optional (2026-09-28): the first screen stopped asking for it, and
 * the service applies `DEFAULT_INTERVAL_HOURS` when it is absent. It stays in the schema
 * because the same endpoint serves a returning visit from Settings, where the interval is
 * a control and the value is real.
 */
export const OnboardingRequestSchema = z.object({
  name: z.string(),
  github: z.string(),
  huggingface: z.string(),
  intervalHours: z.number().int().optional(),
});

export const OnboardingResponseSchema = z.object({
  profile: ProfileSchema,
  accounts: z.array(AccountSchema),
  jobIds: z.array(z.string()),
});

/**
 * The field a refusal belongs to, from its code (`onboarding_github` → `github`), so the form
 * can put the sentence under the right input.
 */
export const ONBOARDING_FIELDS = [
  "name",
  "github",
  "huggingface",
  "accounts",
  "intervalHours",
] as const;
export type OnboardingField = (typeof ONBOARDING_FIELDS)[number];

export type Profile = z.infer<typeof ProfileSchema>;
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;
