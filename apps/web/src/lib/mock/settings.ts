import { THEME_IDS } from "@taste-inbox/ui/theme";
import {
  CEREMONIAL_ENTRY_MODES,
  CeremonialEntrySchema,
  SettingKeySchema,
  SettingsDocumentSchema,
  type CeremonialEntry,
  type SettingsDocument,
  type SettingsPatchRequest,
  type SourcePlatform,
} from "@taste-inbox/shared";

/**
 * Mock settings.
 *
 * Every value below is the one `config/app.example.yaml` actually ships, and every
 * `editable` flag is the one the code actually earns. That is the whole point of this
 * fixture: the settings screen exists to answer "where did this number come from?", and a
 * fixture that invented a friendlier answer would make the screen pass its own tests while
 * lying about the product.
 *
 * Four flags are `true`. Three are the collection fields with a reader
 * (`collection.interval_hours`, `collection.stagger_minutes`,
 * `collection.allow_manual_refresh` — `api/schedule.py`, `api/launchd.py`, `api/app.py:269`);
 * the fourth is `general.ceremonialEntry`, whose reader is the startup route that turns it
 * into Splash → Greeting → Today, Greeting → Today, or Today.
 * `general.timezone` has a reader too and is still `false`, because `AppSection.timezone` is
 * a bare `str` and `api/schedule.py:46-52` answers a typo by falling back to UTC instead of
 * failing: a mistyped zone would move Today's day boundary and every collection slot by
 * hours while leaving the wrong string on screen as the explanation. (The live service does
 * offer it, guarded by `_reject_unknown_timezone`; this fixture is the stricter of the two on
 * purpose, so a screen test cannot lean on a control the mock cannot validate.) The remaining
 * eight are `false` because nothing anywhere reads them.
 */

/** `config/app.example.yaml`, verbatim. Changing a number here changes what the screen claims. */
const SHIPPED = {
  intervalHours: 4,
  staggerMinutes: 3,
  allowManualRefresh: true,
  timezone: "Asia/Seoul",
  locale: "ko-KR",
  defaultTheme: "meadow-cream",
  defaultMotion: "cinematic",
} as const;

/**
 * `debug_retention_days` is absent from the shipped example, so it resolves to the field
 * default in `config/schema.py` — which is what makes it the one `origin: "default"` row on
 * the whole screen, and worth keeping as a fixture case.
 */
const DEBUG_RETENTION_DEFAULT_DAYS = 7;

/**
 * The other `origin: "default"` row, and the only one that is deliberate.
 *
 * `app.ceremonial_entry` is absent from the shipped example because this screen is where it
 * is meant to be written; the `full` below is the pydantic default, which is the journey the
 * approved reference itself walks. If a `ceremonial_entry:` line is ever added to
 * `config/app.example.yaml`, this row's origin becomes `file` and this constant is the thing
 * that has to move.
 */
const CEREMONIAL_ENTRY_DEFAULT: CeremonialEntry = "full";

/**
 * The ceiling `staggerMinutes` may not cross, given the interval currently in effect.
 *
 * `CollectionSection._stagger_must_fit_inside_one_interval` rejects
 * `stagger_minutes × 5 >= interval_hours × 60` — five sources staggered behind each other
 * must all start inside one interval. Sending the static 60 as `max` would let the control
 * compose `interval=1, stagger=15`, which is inside both per-field ranges and still a 422.
 * Deriving it means the control physically cannot build the invalid pair.
 */
export function staggerCeiling(intervalHours: number): number {
  return Math.min(60, intervalHours * 12 - 1);
}

/** The pair check itself, so the mock refuses exactly what pydantic refuses. */
function staggerFitsInterval(intervalHours: number, staggerMinutes: number): boolean {
  return staggerMinutes * 5 < intervalHours * 60;
}

export interface MockSettingRejection {
  /**
   * Whatever the caller named. A dotted `SettingKey` for the document patch, a platform for
   * the per-source one — and an unrecognised string when that is what arrived, since a key
   * the screen cannot place is exactly the case worth reporting rather than narrowing away.
   */
  readonly key: string;
  readonly message: string;
}

/** Thrown by `MockSettingsStore.apply`; `MockRepository` re-raises it as an `ApiDataError`. */
export class MockSettingRejected extends Error {
  constructor(readonly rejection: MockSettingRejection) {
    super(rejection.message);
    this.name = "MockSettingRejected";
  }
}

/**
 * In-memory stand-in for the `settings` table.
 *
 * It holds only what a patch can reach. Everything else is read straight from `SHIPPED`
 * every time, because a field nothing can write has no state to keep — and giving it one
 * would be the first step toward a mock that drifts from the config it claims to mirror.
 *
 * `origin` here is a claim about this store, not about the running collectors. That is the
 * same claim the live backend makes today: the `settings` table has no reader, so a written
 * value is persisted and still not the value `load_app_document()` hands to the scheduler.
 * The screen's copy carries that; this class only has to be consistent.
 */
export class MockSettingsStore {
  private intervalHours: number = SHIPPED.intervalHours;
  private staggerMinutes: number = SHIPPED.staggerMinutes;
  private allowManualRefresh: boolean = SHIPPED.allowManualRefresh;
  private ceremonialEntry: CeremonialEntry = CEREMONIAL_ENTRY_DEFAULT;
  private readonly changed = new Set<string>();

  constructor(private readonly generatedAt: string) {}

  /**
   * `base` is the layer this value falls back to when nobody has written it here.
   *
   * `file` for everything the shipped example names, `default` for the two it does not —
   * and the difference is the whole screen, so it cannot be one blanket answer.
   */
  private origin(key: string, base: "default" | "file" = "file"): "default" | "file" | "user" {
    return this.changed.has(key) ? "user" : base;
  }

  read(): SettingsDocument {
    return SettingsDocumentSchema.parse({
      generatedAt: this.generatedAt,
      collection: {
        intervalHours: {
          value: this.intervalHours,
          min: 1,
          max: 24,
          origin: this.origin("collection.intervalHours"),
          effect: "nextRun",
          editable: true,
        },
        staggerMinutes: {
          value: this.staggerMinutes,
          min: 0,
          max: staggerCeiling(this.intervalHours),
          origin: this.origin("collection.staggerMinutes"),
          effect: "nextInstall",
          editable: true,
        },
        allowManualRefresh: {
          value: this.allowManualRefresh,
          origin: this.origin("collection.allowManualRefresh"),
          effect: "immediate",
          editable: true,
        },
      },
      appearance: {
        defaultTheme: {
          value: SHIPPED.defaultTheme,
          // The seven ids come from `packages/ui/theme-ids.json`, which is also what
          // `config/schema.py` validates against — one list, two consumers, no third copy.
          options: THEME_IDS,
          origin: "file",
          effect: "immediate",
          editable: false,
        },
        defaultMotion: {
          value: SHIPPED.defaultMotion,
          // Two, not three. `config/schema.py:153` is `Literal["cinematic","reduced"]` while
          // the frontend has `cinematic | ambient | reduced`; `ambient` is a real mode the
          // config cannot express, so the options list is short rather than wrong.
          options: ["cinematic", "reduced"],
          origin: "file",
          effect: "immediate",
          editable: false,
        },
      },
      privacy: {
        debugRetentionDays: {
          value: DEBUG_RETENTION_DEFAULT_DAYS,
          min: 0,
          max: 90,
          origin: "default",
          effect: "nextRun",
          editable: false,
        },
      },
      general: {
        timezone: { value: SHIPPED.timezone, origin: "file", effect: "immediate", editable: false },
        locale: { value: SHIPPED.locale, origin: "file", effect: "immediate", editable: false },
        ceremonialEntry: {
          value: this.ceremonialEntry,
          // Spread from the shared list rather than restated, so the mock cannot offer a
          // fourth mode the entry route has no branch for.
          options: [...CEREMONIAL_ENTRY_MODES],
          origin: this.origin("general.ceremonialEntry", "default"),
          // Not `nextRun` and not `nextInstall`: no plist carries a copy and no collector
          // reads it. The next request for this document already answers with the override —
          // which for a person is the next time they open the app.
          effect: "immediate",
          editable: true,
        },
      },
      features: {
        shareCapture: { value: false, origin: "file", effect: "nextRun", editable: false },
        historicalImport: { value: false, origin: "file", effect: "nextRun", editable: false },
        linkedinCollector: { value: false, origin: "file", effect: "nextRun", editable: false },
        localModelEnrichment: { value: false, origin: "file", effect: "nextRun", editable: false },
      },
      // The same four accounts `MOCK_TODAY` reports on, in the same states, so the two
      // screens cannot tell the user different stories about the same LinkedIn login.
      sources: [
        {
          platform: "github",
          label: "GitHub Star",
          enabled: { value: true, origin: "default", effect: "nextRun", editable: false },
          state: "collected",
          connectedAt: "2026-07-02T09:12:00Z",
          itemCount: 6,
        },
        {
          platform: "instagram",
          label: "Instagram Saved",
          enabled: { value: true, origin: "default", effect: "nextRun", editable: false },
          state: "collected",
          connectedAt: "2026-07-02T09:31:00Z",
          itemCount: 6,
        },
        {
          platform: "threads",
          label: "Threads Repost",
          enabled: { value: true, origin: "default", effect: "nextRun", editable: false },
          state: "collected",
          connectedAt: "2026-07-04T11:02:00Z",
          itemCount: 5,
        },
        {
          platform: "linkedin",
          label: "LinkedIn Reactions",
          enabled: { value: true, origin: "default", effect: "nextRun", editable: false },
          state: "auth_required",
          connectedAt: "2026-07-11T08:45:00Z",
          itemCount: 0,
        },
      ],
    });
  }

  /**
   * Apply a patch the way the service would, then hand back the whole document.
   *
   * Three refusals, all mirroring the backend rather than inventing a mock rule: a key whose
   * `editable` is `false` (writing it would persist a value nothing reads), an entry mode
   * outside `AppSection.ceremonial_entry`'s `Literal`, and a `stagger × 5 >= interval × 60`
   * pair, which is `CollectionSection`'s own cross-field validator. The pair is checked
   * *after* both values are staged, because a patch that moves the interval and the stagger
   * together is legal and each half looks wrong on its own.
   */
  apply(changes: SettingsPatchRequest["changes"]): SettingsDocument {
    let interval = this.intervalHours;
    let stagger = this.staggerMinutes;
    let manual = this.allowManualRefresh;
    let entry = this.ceremonialEntry;
    const touched: string[] = [];

    for (const [rawKey, value] of Object.entries(changes)) {
      const parsed = SettingKeySchema.safeParse(rawKey);
      if (!parsed.success) {
        throw new MockSettingRejected({ key: rawKey, message: "알 수 없는 설정이에요." });
      }
      const key = parsed.data;
      switch (key) {
        case "collection.intervalHours":
          interval = numberOrReject(key, value, 1, 24);
          break;
        case "collection.staggerMinutes":
          stagger = numberOrReject(key, value, 0, 60);
          break;
        case "collection.allowManualRefresh":
          if (typeof value !== "boolean") {
            throw new MockSettingRejected({ key, message: "켜짐 또는 꺼짐만 저장할 수 있어요." });
          }
          manual = value;
          break;
        case "general.ceremonialEntry": {
          // Parsed against the union rather than checked against the options array, so the
          // refusal here is the same shape as `AppSection`'s `Literal` refusal — a mode the
          // startup route has no branch for never reaches the store.
          const mode = CeremonialEntrySchema.safeParse(value);
          if (!mode.success) {
            throw new MockSettingRejected({
              key,
              message: `${CEREMONIAL_ENTRY_MODES.join(" · ")} 중 하나여야 해요.`,
            });
          }
          entry = mode.data;
          break;
        }
        default:
          throw new MockSettingRejected({
            key,
            message: "이 값은 아직 이 화면에서 바꿀 수 없어요.",
          });
      }
      touched.push(key);
    }

    if (!staggerFitsInterval(interval, stagger)) {
      throw new MockSettingRejected({
        key: "collection.staggerMinutes",
        message: `계정별 시차는 한 번의 수집 간격 안에 모두 들어가야 해요. ${String(interval)}시간 간격이면 ${String(staggerCeiling(interval))}분까지 넣을 수 있어요.`,
      });
    }

    this.intervalHours = interval;
    this.staggerMinutes = stagger;
    this.allowManualRefresh = manual;
    this.ceremonialEntry = entry;
    for (const key of touched) {
      this.changed.add(key);
    }
    return this.read();
  }

  /**
   * `PATCH /api/settings/sources/{platform}`.
   *
   * Refused in every case, and that is the honest answer rather than a missing feature:
   * `source_accounts.enabled` is written once as the literal `enabled=1`
   * (`ingest/captures.py:174`) and read by nothing — collector selection walks a hardcoded
   * `SOURCE_ORDER`. Storing a `false` here would produce a switch that turns off nothing.
   */
  applySource(platform: SourcePlatform, _enabled: boolean): SettingsDocument {
    throw new MockSettingRejected({
      key: platform,
      message: `${platform} 계정은 아직 이 화면에서 켜고 끌 수 없어요.`,
    });
  }
}

function numberOrReject(
  key: string,
  value: number | boolean | string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MockSettingRejected({ key, message: "정수만 저장할 수 있어요." });
  }
  if (value < min || value > max) {
    throw new MockSettingRejected({
      key,
      message: `${String(min)}에서 ${String(max)} 사이의 값만 저장할 수 있어요.`,
    });
  }
  return value;
}
