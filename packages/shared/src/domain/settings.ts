import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { SourcePlatformSchema } from "./common";
import { SourceCollectionStateSchema } from "./today";

/**
 * `GET /api/settings` payload, and the two `PATCH` bodies that write it.
 *
 * The screen this describes exists to answer one question the product could not previously
 * answer at all: **where did this number come from?** `config/app.example.yaml` carries 17
 * fields and exactly four of them have a reader — `app.timezone`, `collection.interval_hours`,
 * `collection.stagger_minutes`, `collection.allow_manual_refresh`. The other thirteen validate
 * on load and are then consumed by nobody. A settings screen that renders all 17 as identical
 * switches would be thirteen-seventeenths a lie, so every value here is wrapped rather than
 * sent bare: the wrapper is what lets the UI print `4` next to "이 값은 아직 아무 것도 읽지
 * 않아요" instead of next to an editable slider.
 *
 * A fifth field has a reader and is deliberately *not* in that file: `app.ceremonial_entry`
 * defaults in `config/schema.py` and is meant to be written from this screen rather than by
 * hand, so on a fresh checkout it reports `origin: "default"` — the only other value that
 * does is `app.debug_retention_days`, which the example simply forgets.
 *
 * Three facts about the backend shape this file:
 *
 * 1. **There is no cache.** `config/loader.py` has no `lru_cache` anywhere and re-`stat`s the
 *    config path on every call, so a value that lands in the effective YAML is live on the
 *    next request with no restart. That is why `effect: "immediate"` is a truthful claim for
 *    the collection fields *as displayed by `/api/collection/schedule`*.
 * 2. **An installed launchd job is a different clock.** `StartInterval` is baked into the
 *    plist at generation time and counted from when the job was loaded, so a loaded job fires
 *    on `설치 시각 + N × interval` and keeps doing so until somebody runs `launchctl bootout`
 *    and `bootstrap` by hand — nothing in this repository executes `launchctl`
 *    (`api/launchd.py:11-30`, `:156-179`). `effect: "nextInstall"` names that gap.
 * 3. **`settings` (`db/models.py:403-408`) is a created-and-forgotten table.** Zero reads,
 *    zero writes, no index, referenced only by the migration that made it. Nothing that
 *    consumes a setting today looks anywhere but at the YAML, which is why `origin: "user"`
 *    is a claim about persistence and not yet a claim about effect — see the note on
 *    `SettingOriginSchema`.
 */

/**
 * Where the effective value came from. **This is the point of the whole screen.**
 *
 * - `default` — the field default in `config/schema.py`, because the effective YAML does not
 *   mention the key at all. Three fields are in this state today (`media_dir`,
 *   `browser_profile_dir`, `debug_retention_days`); the shipped example simply omits them.
 * - `file` — written in whichever file `config/loader.py:109-121` resolved. Note the trap:
 *   there is no `config/app.yaml` on a fresh checkout (`.gitignore` ignores `config/*.yaml`),
 *   so `file` today means the *committed* `app.example.yaml`. UI copy must not read that as
 *   "누군가 바꾼 값" — it is the shipped value living in a file rather than in a field default.
 * - `user` — a row in the `settings` table, written through `PATCH /api/settings`.
 *
 * The union is an enum and not a string precisely so this distinction cannot rot into free
 * text: a producer that starts sending `"yaml"` or `"config"` fails validation at the
 * boundary instead of rendering an unlabelled value the user cannot place.
 */
export const SettingOriginSchema = z.enum(["default", "file", "user"]);

/**
 * When a change to this value starts being true.
 *
 * - `immediate` — the next request already reads it. True because nothing caches the config
 *   document (`config/loader.py`), so `/api/collection/schedule`, `/api/today`, the Refresh
 *   gate at `api/app.py:269` and the startup route's read of this payload all recompute from
 *   disk per call. It is a claim about the next *request*, never about the screen in front of
 *   you: `allowManualRefresh` is observed the next time Refresh is pressed and
 *   `ceremonialEntry` the next time the app is opened, and neither redraws Settings.
 * - `nextRun` — the value is read when a collector or enricher next runs, not now.
 * - `nextInstall` — the value is copied into a launchd plist at generation time and a job
 *   already loaded keeps its old copy until a person re-runs the printed `bootout`/`bootstrap`
 *   pair. Nothing here can perform that step.
 *
 * There is deliberately **no** member for "nothing reads this value at all", which is the
 * honest answer for `appearance.*`, `privacy.debugRetentionDays`, `features.*`, `general.locale`
 * and every `sources[].enabled`. Those are marked `editable: false` instead, and the screen
 * must carry the explanation in copy rather than in this union — see the field notes below
 * for which ones and why.
 */
export const SettingEffectSchema = z.enum(["immediate", "nextRun", "nextInstall"]);

/**
 * What every setting carries regardless of its type.
 *
 * `editable` is a backend decision, not a UI one. A value can be un-editable for two very
 * different reasons — nothing reads it, or writing it is unsafe — and both have to arrive as
 * `false` because the frontend cannot tell them apart by looking at the value. The reason
 * belongs in the screen's copy; the boolean only decides whether a control is rendered.
 */
const settingBase = {
  origin: SettingOriginSchema,
  effect: SettingEffectSchema,
  /** False when the UI must show this read-only. Never inferred from `origin` or `effect`. */
  editable: z.boolean(),
};

/**
 * A number, with the bounds the backend will actually enforce.
 *
 * Integer-only: all three numeric settings are `int` in `config/schema.py`, and a slider that
 * emits `4.5` hours would be rejected by pydantic after the user had already seen the value
 * move. Rounding at the schema boundary is cheaper than a 422.
 *
 * `min` and `max` travel with the value rather than being duplicated into the frontend so
 * that the bounds have exactly one home. The refinement below then holds the pair honest: a
 * producer that sends `{value: 30, min: 1, max: 24}` is a bug in the producer, and catching it
 * here turns it into a validation error at one place instead of a slider whose thumb sits
 * outside its own track.
 *
 * **The bounds are per-field and the backend's are not.**
 * `CollectionSection._stagger_must_fit_inside_one_interval` (`config/schema.py`) rejects
 * `stagger_minutes × 5 >= interval_hours × 60`, so `staggerMinutes` and `intervalHours` are
 * coupled and a pair inside both static ranges can still be refused. If `staggerMinutes.max`
 * is sent as the static 60 the UI can offer `interval=1, stagger=15` and earn a 422 for it;
 * sending the *derived* ceiling instead makes the control unable to compose an invalid pair.
 */
export const SettingNumberSchema = z
  .object({
    ...settingBase,
    value: z.number().int(),
    min: z.number().int(),
    max: z.number().int(),
  })
  .refine((setting) => setting.min <= setting.max, {
    message: "min must not exceed max",
    path: ["min"],
  })
  .refine((setting) => setting.value >= setting.min && setting.value <= setting.max, {
    message: "value must lie inside its own declared bounds",
    path: ["value"],
  });

/** A switch. No bounds to declare — the two states are the whole domain. */
export const SettingBooleanSchema = z.object({
  ...settingBase,
  value: z.boolean(),
});

/**
 * One of a closed list the backend names at runtime.
 *
 * `options` is sent rather than hardcoded here because the three choices are owned elsewhere
 * and would drift if copied: theme ids are validated by `config/schema.py` against
 * `packages/ui/theme-ids.json` (seven ids), and this package has no dependency on
 * `packages/ui` — adding one to restate a list the payload already carries would create a
 * second place for the seven to disagree. `defaultMotion` and `ceremonialEntry` are
 * `Literal` unions on the pydantic sections and arrive the same way.
 *
 * The options are ids, not labels. `packages/ui` already holds one display name per theme; a
 * Korean label in this payload would be a second copy of it, and the copy in an API response
 * is the one nobody updates.
 *
 * An empty `options` is refused: a choice with nothing to choose from is a text field that
 * lost its content, and it would silently make the `value ∈ options` check vacuous.
 */
export const SettingChoiceSchema = z
  .object({
    ...settingBase,
    value: z.string().min(1),
    options: z.array(z.string().min(1)).min(1),
  })
  .refine((setting) => setting.options.includes(setting.value), {
    message: "value must be one of the declared options",
    path: ["value"],
  });

/**
 * Free text with no closed vocabulary the API layer can state.
 *
 * Used for `timezone` and `locale`, both plain `str` in `config/schema.py` with no validator.
 * That absence is why `general.timezone` needs care: `api/schedule.py:46-52` catches an
 * unreadable zone name and falls back to `UTC` rather than failing, so a typo does not error —
 * it silently moves Today's day boundary and every collection slot by nine hours and leaves
 * the wrong string on screen as the explanation. A control that writes this must validate
 * against `zoneinfo.available_timezones()` first, or ship `editable: false`.
 */
export const SettingTextSchema = z.object({
  ...settingBase,
  value: z.string(),
});

/**
 * How much ceremony the app opens with — `PAGE_SPECIFICATIONS.md` §11.1, §7 routing logic.
 *
 * - `full` — Splash → Greeting → Today. The default, and the journey the approved reference
 *   itself walks (`reference/ref.js` navigates `0 → 1 → 2`).
 * - `brief` — Greeting → Today. No dark Splash.
 * - `skip` — straight to Today.
 *
 * **Named here even though `SettingChoiceSchema.options` already carries the list**, because
 * this is the one choice a client has to *branch* on: the startup route picks a different
 * sequence of screens per member, and a `z.string()` cannot be switched over exhaustively.
 * The theme picker never branches, which is why no equivalent exists for it.
 *
 * That makes this a second home for a vocabulary owned by `config/schema.py`, so both ends
 * are pinned: `apps/api/tests/test_settings.py` asserts the payload's `options` are exactly
 * these three, and the test below asserts this list is. Read a value with
 * `CeremonialEntrySchema.catch("full")` — a payload that grows a fourth mode should send the
 * user through the approved journey, not through an entry route that threw.
 */
export const CEREMONIAL_ENTRY_MODES = ["full", "brief", "skip"] as const;

export const CeremonialEntrySchema = z.enum(CEREMONIAL_ENTRY_MODES);

/**
 * One connected account as the settings screen sees it.
 *
 * `enabled` is a full `SettingBoolean` rather than a bare boolean, and that is the only shape
 * that can tell the truth about it. `source_accounts.enabled` is written once as the literal
 * `enabled=1` in `ingest/captures.py:174` and read by nothing anywhere — collector selection
 * never touches the table (`api/schedule.py` iterates a hardcoded `SOURCE_ORDER`,
 * `api/launchd.py` generates a plist for all six regardless). A bare boolean would render as a
 * working switch; the wrapper carries the `editable: false` that keeps it from pretending.
 *
 * `state` reuses the Today union so the two screens cannot disagree about what
 * `auth_required` means. Note it must be resolved the way `api/today.py` resolves it — from
 * `checkpoints` and `collector_runs` — and not from `source_accounts.state`, which is only
 * ever written as the literal `"collected"` and would report every account healthy.
 */
export const SourceSettingSchema = z.object({
  platform: SourcePlatformSchema,
  /** As the product names the account, e.g. `Instagram · 저장됨`. */
  label: z.string().min(1),
  enabled: SettingBooleanSchema,
  state: SourceCollectionStateSchema,
  /** When the account first produced a capture. Null for a platform never connected. */
  connectedAt: IsoDateTimeSchema.nullable(),
  /** Items collected from this account so far — a count, never a cap. */
  itemCount: z.number().int().nonnegative(),
});

export const SettingsDocumentSchema = z.object({
  /** `api/cards.py::generated_at()` — second precision, `Z` suffix, when this was assembled. */
  generatedAt: IsoDateTimeSchema,
  /**
   * The only section where a change reaches running code today.
   *
   * `intervalHours` and `staggerMinutes` carry `nextInstall` because a loaded launchd job
   * holds the copy it was bootstrapped with, while the schedule *display* recomputes per
   * request — one value, two clocks, and `api/launchd.py:28-30` says so in the source.
   * `allowManualRefresh` is the one genuinely immediate control: `api/app.py:269` reads it on
   * every `POST /api/collection/refresh` and answers 409 `manual_refresh_disabled`.
   */
  collection: z.object({
    intervalHours: SettingNumberSchema,
    staggerMinutes: SettingNumberSchema,
    allowManualRefresh: SettingBooleanSchema,
  }),
  /**
   * Read-only display of what the config file says, not a theme switcher.
   *
   * Neither field has a consumer. The web app resolves its theme from
   * `localStorage[THEME_STORAGE_KEY]` falling back to `theme-ids.json`, and its motion from
   * `DEFAULT_MOTION_MODE` in `components/theme/theme-bootstrap.ts:29` — never from the API.
   * The two vocabularies do not even match: `config/schema.py:153` allows
   * `cinematic | reduced` while the frontend has three modes and `ambient` is the one the
   * config cannot express.
   */
  appearance: z.object({
    defaultTheme: SettingChoiceSchema,
    defaultMotion: SettingChoiceSchema,
  }),
  /**
   * `app.debug_retention_days` validates 0–90 and is read by nobody.
   *
   * `browser_sources.py:663` calls `capture_failure(page, surface=..., outcome=...)` without
   * `retention_days`, so the sweep uses the collectors package's own
   * `DEFAULT_RETENTION_DAYS = 7` (`browser/failure_capture.py:32`). Two numbers, one of them
   * decorative. Until that call site passes the config value, an editable field here would be
   * a number the user sets and the sweep ignores — worse than a printed 7.
   */
  privacy: z.object({
    debugRetentionDays: SettingNumberSchema,
  }),
  general: z.object({
    /** Live: the day boundary on Today and the slot boundary on the schedule are this one value. */
    timezone: SettingTextSchema,
    /** Inert: `app.locale` is asserted by one config test and read by no application code. */
    locale: SettingTextSchema,
    /**
     * Live: the startup route reads this payload and sends the user through the sequence it
     * names — `CEREMONIAL_ENTRY_MODES` above.
     *
     * The only `editable: true` value whose reader is the web app rather than the service,
     * and it is not the contradiction `appearance.defaultTheme` would be. The theme has a
     * *competing* resolver — `components/theme/theme-bootstrap.ts` reads `localStorage` and
     * never asks the API — so an override there moves nothing. This payload is the entry
     * sequence's only source; there is no second place for it to disagree with.
     */
    ceremonialEntry: SettingChoiceSchema,
  }),
  /**
   * CLAUDE.md §7 says "Each platform collector is independently feature-flagged". That is the
   * intent; none of these four booleans is read by anything, so setting `linkedinCollector`
   * true starts no collector. They are in the document because the config validates them and
   * the user can see them in the file — all four `editable: false`.
   */
  features: z.object({
    shareCapture: SettingBooleanSchema,
    historicalImport: SettingBooleanSchema,
    linkedinCollector: SettingBooleanSchema,
    localModelEnrichment: SettingBooleanSchema,
  }),
  sources: z.array(SourceSettingSchema),
});

/**
 * Every writable path, spelled the way `PATCH /api/settings` expects it.
 *
 * Dotted rather than nested because a patch body has to name a leaf without restating the
 * branches around it — `{"collection.intervalHours": 6}` is one key, while a nested body would
 * be three objects deep and indistinguishable from "replace the whole collection section with
 * this one field". The keys are camelCase like the rest of the payload; the API layer maps
 * them onto the snake_case pydantic fields, which is the same translation every other endpoint
 * already performs.
 *
 * `sources[].enabled` is absent on purpose: it is per-platform and gets its own endpoint,
 * because a dotted key would have to embed the platform and become parseable-not-enumerable.
 *
 * Hand-written and then checked against `SettingsDocumentSchema` by a test that walks the
 * document's leaves, so a field added to the document without a key here fails the suite
 * rather than becoming quietly unpatchable. Longest key is 29 characters against the
 * `String(128)` primary key of the `settings` table (`db/models.py:406`).
 */
export const SETTING_KEYS = [
  "collection.intervalHours",
  "collection.staggerMinutes",
  "collection.allowManualRefresh",
  "appearance.defaultTheme",
  "appearance.defaultMotion",
  "privacy.debugRetentionDays",
  "general.timezone",
  "general.locale",
  "general.ceremonialEntry",
  "features.shareCapture",
  "features.historicalImport",
  "features.linkedinCollector",
  "features.localModelEnrichment",
] as const;

export const SettingKeySchema = z.enum(SETTING_KEYS);

/**
 * `PATCH /api/settings` body.
 *
 * Partial by construction: a patch names only what changed, and `z.partialRecord` refuses a
 * key outside `SETTING_KEYS` instead of forwarding a typo to the backend to be silently
 * dropped. A typo'd key is the failure this guards — the response is the full refreshed
 * document either way, so a dropped change looks exactly like a change that had no effect.
 *
 * The value union is deliberately loose. Per-key value types would have to be maintained here
 * as a second copy of the pydantic models, and the backend re-validates through those models
 * anyway so that the cross-field validators still run; a mismatch is a typed 422 naming the
 * key, not something this schema needs to pre-empt.
 */
export const SettingsPatchRequestSchema = z.object({
  changes: z.partialRecord(SettingKeySchema, z.union([z.number(), z.boolean(), z.string()])),
});

/** `PATCH /api/settings/sources/{platform}` body. */
export const SourceSettingPatchRequestSchema = z.object({
  enabled: z.boolean(),
});

export type SettingOrigin = z.infer<typeof SettingOriginSchema>;
export type SettingEffect = z.infer<typeof SettingEffectSchema>;
export type SettingNumber = z.infer<typeof SettingNumberSchema>;
export type SettingBoolean = z.infer<typeof SettingBooleanSchema>;
export type SettingChoice = z.infer<typeof SettingChoiceSchema>;
export type SettingText = z.infer<typeof SettingTextSchema>;
export type CeremonialEntry = z.infer<typeof CeremonialEntrySchema>;
export type SourceSetting = z.infer<typeof SourceSettingSchema>;
export type SettingsDocument = z.infer<typeof SettingsDocumentSchema>;
export type SettingKey = z.infer<typeof SettingKeySchema>;
export type SettingsPatchRequest = z.infer<typeof SettingsPatchRequestSchema>;
export type SourceSettingPatchRequest = z.infer<typeof SourceSettingPatchRequestSchema>;
