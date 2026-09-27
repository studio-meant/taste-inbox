import type { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  AIItemCardModelSchema,
  CeremonialEntrySchema,
  EvidenceRefSchema,
  ItemKindSchema,
  ItemDomainSchema,
  JobModelSchema,
  JobStateSchema,
  ManualItemCreateRequestSchema,
  OutboundLinkKindSchema,
  OutboundLinkOriginSchema,
  SETTING_KEYS,
  SettingChoiceSchema,
  SettingEffectSchema,
  SettingNumberSchema,
  SettingOriginSchema,
  SettingsDocumentSchema,
  SettingsPatchRequestSchema,
  SourcePlatformSchema,
  StyleItemCardModelSchema,
  StyleMatchGradeSchema,
} from "../src/domain/index";

/**
 * These assertions pin the unions to docs/FRONTEND_COMPONENT_ARCHITECTURE.md §11.
 * If the document changes, this test must be updated in the same commit.
 */
describe("documented unions", () => {
  it("OutboundLinkKind", () => {
    // The Python producer decides these strings by inspecting an evidence row's type, and
    // a name that drifts on one side is a runtime validation error on the other. Ordered
    // by how actionable the destination is, which is the order the card renders them in.
    expect(OutboundLinkKindSchema.options).toEqual([
      "artifact",
      "shop",
      "resolved",
      "outbound",
      "unresolved",
    ]);
  });

  it("OutboundLinkOrigin", () => {
    // A commenter's link is not the author's claim, and a bio link is not a claim about
    // this post at all — the card labels each so a click is never read as more than it is.
    expect(OutboundLinkOriginSchema.options).toEqual(["post", "comment", "profile"]);
  });

  it("ItemKind", () => {
    expect(ItemKindSchema.options).toEqual([
      "repo",
      "model",
      // Hugging Face `repo.type` values, added 2026-09-28.
      "dataset",
      "space",
      "paper",
      "demo",
      "tool",
      "post",
      "product",
      "outfit",
    ]);
  });

  it("ItemDomain", () => {
    // Today highlights use the same presentation rule as Browse: a pending Instagram
    // Like is visible on None until it receives a filed board.
    expect(ItemDomainSchema.options).toEqual(["trends", "style", "music", "places", "none"]);
  });

  it("SourcePlatform", () => {
    expect(SourcePlatformSchema.options).toEqual([
      "github",
      "huggingface",
      "arxiv",
      "threads",
      "linkedin",
      "instagram",
      "web",
    ]);
  });

  it("StyleMatchGrade", () => {
    // No Style card carries one any more. The union survives because `STYLE_MATCH` in the
    // status registry and the `match` filter in the URL are still built from it, and this
    // assertion is what keeps those two agreeing on the vocabulary.
    expect(StyleMatchGradeSchema.options).toEqual(["exact", "likely", "similar", "unknown"]);
  });

  it("JobState", () => {
    expect(JobStateSchema.options).toEqual([
      "queued",
      "running",
      "succeeded",
      "partially_succeeded",
      "failed",
      "cancelled",
      "blocked",
    ]);
  });
});

describe("model schemas", () => {
  const source = {
    platform: "github",
    label: "GitHub Star",
    originalUrl: "https://github.com/example/example",
    author: null,
    actionType: "star",
    firstSeenAt: "2026-08-08T06:31:00Z",
  };

  it("accepts a collected AI card with nothing enriched", () => {
    // Every execution field is gone with the sandbox runner. What remains is what was
    // actually collected, so a card carrying only that must parse.
    const parsed = AIItemCardModelSchema.parse({
      id: "example-repo",
      kind: "repo",
      title: "Example repository",
      source,
      summary: "설명 문장",
      checkedAt: null,
      preview: null,
    });
    expect(parsed.tags).toEqual([]);
    expect(parsed.links).toEqual([]);
  });

  it("drops an execution verdict a stale producer still sends", () => {
    // The schema strips unknown keys rather than rejecting them, which is the behaviour
    // that matters here: a producer that has not been updated cannot get a claim about
    // running code onto a card, it simply does not arrive.
    const parsed = AIItemCardModelSchema.parse({
      id: "example-repo",
      kind: "repo",
      title: "Example repository",
      source,
      summary: "",
      checkedAt: null,
      preview: null,
      status: "ready_local",
      peakMemoryGb: 40,
      requiredSecrets: ["HF_TOKEN"],
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("peakMemoryGb");
    expect(parsed).not.toHaveProperty("requiredSecrets");
  });

  it("accepts a collected Style card with no photo at all", () => {
    // Every product field is gone with the product resolver. What remains is what was
    // actually collected, and an item whose photo never arrived must still parse.
    const parsed = StyleItemCardModelSchema.parse({
      id: "example-outfit",
      source: { ...source, platform: "instagram", actionType: "save" },
      media: [],
      descriptor: "그레이 울 블렌드 미니 스커트",
      caption: "그레이 울 블렌드 미니 스커트\n#데일리룩",
      checkedAt: null,
    });
    expect(parsed.media).toEqual([]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.links).toEqual([]);
  });

  it("keeps every photo of a carousel, in order", () => {
    const photo = (id: string) => ({
      id,
      type: "image" as const,
      src: `https://cdn.example/${id}.jpg`,
      alt: "저장한 게시물의 사진",
    });
    const parsed = StyleItemCardModelSchema.parse({
      id: "example-outfit",
      source: { ...source, platform: "instagram", actionType: "save" },
      media: [photo("a"), photo("b"), photo("c")],
      descriptor: "여름 코디",
      caption: "여름 코디",
      checkedAt: null,
    });
    expect(parsed.media.map((image) => image.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a product claim a stale producer still sends", () => {
    // The schema strips unknown keys rather than rejecting them, which is the behaviour
    // that matters: a producer that has not been updated cannot get a price or a match
    // grade onto a card, it simply does not arrive.
    const parsed = StyleItemCardModelSchema.parse({
      id: "example-outfit",
      source: { ...source, platform: "instagram", actionType: "save" },
      media: [],
      descriptor: "그레이 울 블렌드 미니 스커트",
      caption: "",
      checkedAt: null,
      brand: "Example Studio",
      matchGrade: "exact",
      currentPrice: { amount: 89000, currency: "KRW" },
      retailerCount: 2,
      stockState: "available",
    });
    expect(parsed).not.toHaveProperty("brand");
    expect(parsed).not.toHaveProperty("matchGrade");
    expect(parsed).not.toHaveProperty("currentPrice");
    expect(parsed).not.toHaveProperty("stockState");
  });

  it("requires evidence provenance", () => {
    expect(() =>
      EvidenceRefSchema.parse({
        id: "e1",
        type: "readme",
        label: "설치 방법",
        value: "uv sync",
      }),
    ).toThrow();
  });

  it("accepts a blocked job with a failed step", () => {
    const parsed = JobModelSchema.parse({
      id: "job-1",
      type: "collection",
      state: "blocked",
      title: "Threads 수집",
      steps: [{ id: "s1", label: "로그인 확인", state: "failed", message: "auth_required" }],
      cancellable: false,
    });
    expect(parsed.state).toBe("blocked");
  });
});

describe("manual item input", () => {
  it("accepts a user-authored web link without requiring fetched metadata", () => {
    expect(
      ManualItemCreateRequestSchema.parse({
        url: "https://www.instagram.com/reel/Manual_123/",
        board: "music",
      }),
    ).toEqual({
      url: "https://www.instagram.com/reel/Manual_123/",
      board: "music",
    });
  });

  it("rejects non-web schemes and unknown boards", () => {
    expect(
      ManualItemCreateRequestSchema.safeParse({ url: "javascript:alert(1)", board: "music" })
        .success,
    ).toBe(false);
    expect(
      ManualItemCreateRequestSchema.safeParse({ url: "https://example.com", board: "archive" })
        .success,
    ).toBe(false);
  });
});

/**
 * `GET /api/settings`.
 *
 * The screen exists to say where a value came from, so the assertions here are about the
 * wrapper and not the values: an `origin` that has drifted into free text, a slider whose
 * thumb sits outside its own track, and a dotted patch key that no longer names a field are
 * the three ways this contract rots without anything visibly breaking.
 */
describe("settings document", () => {
  /**
   * The document as the API would assemble it, with every value at the number the shipped
   * `config/app.example.yaml` actually carries — 4 hours, 3 minutes, manual refresh on — so a
   * test that has to name a value names the real one rather than a round number.
   *
   * Rebuilt per call because most tests here mutate one branch of it.
   */
  const settingsDocument = () => ({
    generatedAt: "2026-08-09T09:00:00Z",
    collection: {
      intervalHours: {
        value: 4,
        origin: "file",
        effect: "nextInstall",
        editable: true,
        min: 1,
        max: 24,
      },
      staggerMinutes: {
        value: 3,
        origin: "file",
        effect: "nextInstall",
        editable: true,
        min: 0,
        max: 60,
      },
      allowManualRefresh: {
        value: true,
        origin: "file",
        effect: "immediate",
        editable: true,
      },
    },
    appearance: {
      defaultTheme: {
        value: "revised-green-cream",
        origin: "file",
        effect: "immediate",
        editable: false,
        options: [
          "bright-forest",
          "cream-ivory",
          "soft-cream-wood",
          "spring-sage",
          "green-cream-wood",
          "revised-green-cream",
          "room2-90",
        ],
      },
      defaultMotion: {
        value: "cinematic",
        origin: "file",
        effect: "immediate",
        editable: false,
        options: ["cinematic", "reduced"],
      },
    },
    privacy: {
      debugRetentionDays: {
        // `origin: "default"` and not `"file"`: the shipped example omits the key entirely,
        // so the 7 comes from the pydantic field default in `config/schema.py`.
        value: 7,
        origin: "default",
        effect: "nextRun",
        editable: false,
        min: 0,
        max: 90,
      },
    },
    general: {
      timezone: { value: "Asia/Seoul", origin: "file", effect: "immediate", editable: false },
      locale: { value: "ko-KR", origin: "file", effect: "immediate", editable: false },
      ceremonialEntry: {
        // `origin: "default"` for the same reason as `debugRetentionDays` and a different
        // motive: the shipped example never names it, because this screen is where it is
        // meant to be written.
        value: "full",
        origin: "default",
        effect: "immediate",
        editable: true,
        options: ["full", "brief", "skip"],
      },
    },
    features: {
      shareCapture: { value: false, origin: "file", effect: "nextRun", editable: false },
      historicalImport: { value: false, origin: "file", effect: "nextRun", editable: false },
      linkedinCollector: { value: false, origin: "file", effect: "nextRun", editable: false },
      localModelEnrichment: { value: false, origin: "file", effect: "nextRun", editable: false },
    },
    sources: [
      {
        platform: "instagram",
        label: "Instagram · 저장됨",
        enabled: { value: true, origin: "default", effect: "nextRun", editable: false },
        state: "collected",
        connectedAt: "2026-08-08T06:31:00Z",
        itemCount: 76,
      },
    ],
  });

  it("pins the three origins a value can have", () => {
    // The whole screen is this union. `file` and `default` are not interchangeable — three
    // config fields (`media_dir`, `browser_profile_dir`, `debug_retention_days`) are absent
    // from the shipped example and reach the user as a pydantic field default instead.
    expect(SettingOriginSchema.options).toEqual(["default", "file", "user"]);
  });

  it("pins the three delays a change can have", () => {
    expect(SettingEffectSchema.options).toEqual(["immediate", "nextRun", "nextInstall"]);
  });

  it("refuses an origin that has drifted into free text", () => {
    // A producer that starts sending "yaml" or "config" must fail at the boundary. The
    // alternative is a value rendered with no provenance label at all, which is the one
    // thing this document exists to prevent.
    const document = settingsDocument();
    document.collection.allowManualRefresh.origin = "yaml";
    expect(SettingsDocumentSchema.safeParse(document).success).toBe(false);
  });

  it("refuses a number whose value sits outside its own declared bounds", () => {
    // `interval_hours` is `ge=1, le=24` in config/schema.py. A payload carrying 30 against a
    // max of 24 is a producer bug, and catching it here is what stops a slider from rendering
    // its thumb past the end of its own track.
    const result = SettingNumberSchema.safeParse({
      value: 30,
      origin: "user",
      effect: "nextInstall",
      editable: true,
      min: 1,
      max: 24,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["value"]);
  });

  it("names the offending key when a bound is violated deep in the document", () => {
    // The 422 for a rejected PATCH has to name the key in Korean copy, and the frontend
    // builds that name from the issue path. If the path were the document root the message
    // could only say "무언가 잘못됐어요".
    const document = settingsDocument();
    document.collection.staggerMinutes.value = 90;
    const result = SettingsDocumentSchema.safeParse(document);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["collection", "staggerMinutes", "value"]);
  });

  it("refuses bounds that are backwards", () => {
    expect(
      SettingNumberSchema.safeParse({
        value: 4,
        origin: "file",
        effect: "nextInstall",
        editable: true,
        min: 24,
        max: 1,
      }).success,
    ).toBe(false);
  });

  it("refuses a choice whose value is not among its own options", () => {
    // Theme ids live in packages/ui/theme-ids.json and this package deliberately does not
    // depend on packages/ui, so the payload's own `options` is the only list available to
    // check against. A theme deleted from the seven must not survive as a stored value.
    expect(
      SettingChoiceSchema.safeParse({
        value: "midnight-navy",
        origin: "user",
        effect: "immediate",
        editable: true,
        options: ["revised-green-cream", "room2-90"],
      }).success,
    ).toBe(false);
  });

  it("refuses a choice with nothing to choose from", () => {
    // An empty options array would make the membership check above vacuous and would render
    // as a select with no entries.
    expect(
      SettingChoiceSchema.safeParse({
        value: "cinematic",
        origin: "file",
        effect: "immediate",
        editable: false,
        options: [],
      }).success,
    ).toBe(false);
  });

  it("pins the three ways the app may open", () => {
    // The one choice a client branches on, so its members are a second home for a
    // vocabulary `config/schema.py` owns. Both ends are pinned: this, and
    // `apps/api/tests/test_settings.py`, which asserts the payload's own `options` are these
    // same three in this same order.
    expect(CeremonialEntrySchema.options).toEqual(["full", "brief", "skip"]);
  });

  it("refuses an entry sequence the startup route has no branch for", () => {
    // A stored `cinematic` — the neighbouring choice's vocabulary — would leave the startup
    // route with no matching branch, and the fallback for "no branch matched" is a screen
    // the user did not ask for. `options` is what makes this checkable without this package
    // depending on the pydantic Literal that owns the list.
    const document = settingsDocument();
    document.general.ceremonialEntry.value = "cinematic";
    const result = SettingsDocumentSchema.safeParse(document);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["general", "ceremonialEntry", "value"]);
  });

  it("keeps the entry sequence editable and patchable", () => {
    // `editable: true` is the difference between this choice and the two beside it: the
    // theme has a competing resolver in `theme-bootstrap.ts` that never asks the API, while
    // this payload is the startup route's only source. A schema that could not carry the
    // patch key would make the control unsavable.
    const parsed = SettingsDocumentSchema.parse(settingsDocument());
    expect(parsed.general.ceremonialEntry.editable).toBe(true);
    expect(
      SettingsPatchRequestSchema.safeParse({ changes: { "general.ceremonialEntry": "skip" } })
        .success,
    ).toBe(true);
  });

  it("requires a source switch to carry its own provenance", () => {
    // `source_accounts.enabled` is written once as the literal `enabled=1`
    // (ingest/captures.py:174) and read by nothing, so this switch must be able to arrive
    // `editable: false`. A bare boolean cannot say that, and would render as a working
    // control that stops no collection.
    const document = settingsDocument();
    const bare = { ...document, sources: [{ ...document.sources[0], enabled: true }] };
    expect(SettingsDocumentSchema.safeParse(bare).success).toBe(false);
  });

  it("round-trips a full document unchanged", () => {
    // Parsing must be idempotent: nothing here has a `.default()` or a transform, so the
    // second pass over the first pass's output has to be identical. A default quietly added
    // to a settings field would make the API's answer and the client's copy of it disagree
    // about what the user is looking at.
    const once = SettingsDocumentSchema.parse(settingsDocument());
    expect(SettingsDocumentSchema.parse(once)).toEqual(once);
    expect(once).toEqual(settingsDocument());
  });

  it("drops a notifications section a stale producer still sends", () => {
    // There is no delivery mechanism in the product — `briefing.morning_status_time` is in
    // the config and read by nothing, and no code path sends anything anywhere. Unknown keys
    // are stripped rather than rejected, so a producer that has not been updated cannot get
    // a notification control onto the screen; it simply does not arrive.
    const parsed = SettingsDocumentSchema.parse({
      ...settingsDocument(),
      notifications: {
        morningStatus: { value: "07:00", origin: "file", effect: "nextRun", editable: true },
      },
    });
    expect(parsed).not.toHaveProperty("notifications");
  });

  it("keeps the patch keys and the document's own leaves in step", () => {
    // SETTING_KEYS is hand-written because a dotted key is a wire format and deriving it
    // would hide a rename. This walk is what stops the two from drifting: a field added to
    // the document without a key fails here instead of becoming quietly unpatchable.
    const leaves = (schema: z.ZodObject, prefix: string): string[] => {
      const found: string[] = [];
      for (const [name, field] of Object.entries<z.ZodType>(schema.shape)) {
        const path = prefix === "" ? name : `${prefix}.${name}`;
        if (field.def.type !== "object") {
          continue;
        }
        const branch = field as z.ZodObject;
        if ("origin" in branch.shape) {
          found.push(path);
        } else {
          found.push(...leaves(branch, path));
        }
      }
      return found;
    };
    // `sources[].enabled` is per-platform and has its own endpoint, so it is not a dotted key.
    expect(leaves(SettingsDocumentSchema, "")).toEqual([...SETTING_KEYS]);
  });

  it("refuses a patch key that names no field", () => {
    // A typo'd key forwarded to the backend would be dropped there, and the response is the
    // full refreshed document either way — so a dropped change is indistinguishable from a
    // change that had no effect. This is the only place it can still be seen.
    expect(
      SettingsPatchRequestSchema.safeParse({ changes: { "collection.interval_hours": 6 } }).success,
    ).toBe(false);
    expect(
      SettingsPatchRequestSchema.safeParse({ changes: { "collection.intervalHours": 6 } }).success,
    ).toBe(true);
  });

  it("accepts a patch that names one key out of thirteen", () => {
    // Partial by construction: a body is what changed, not the document restated. An
    // exhaustive record would force the client to echo twelve values it never touched.
    const parsed = SettingsPatchRequestSchema.parse({
      changes: { "collection.allowManualRefresh": false },
    });
    expect(Object.keys(parsed.changes)).toEqual(["collection.allowManualRefresh"]);
  });
});
