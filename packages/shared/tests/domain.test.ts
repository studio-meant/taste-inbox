import type { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  AIItemCardModelSchema,
  CeremonialEntrySchema,
  EvidenceRefSchema,
  ItemKindSchema,
  JobModelSchema,
  JobTypeSchema,
  JobStateSchema,
  ManualItemCreateRequestSchema,
  OutboundLinkKindSchema,
  SavedSummarySchema,
  SETTING_KEYS,
  SettingChoiceSchema,
  SettingEffectSchema,
  SettingNumberSchema,
  SettingOriginSchema,
  SettingsDocumentSchema,
  SettingsPatchRequestSchema,
  SourcePlatformSchema,
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
    // Shops, shorteners and comment links went with Instagram, Threads and LinkedIn.
    expect(OutboundLinkKindSchema.options).toEqual(["artifact", "outbound"]);
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
    ]);
  });

  it("SourcePlatform", () => {
    // Mirrors `db/models.py::PLATFORMS`. Instagram, Threads and LinkedIn went on 2026-09-28.
    expect(SourcePlatformSchema.options).toEqual(["github", "huggingface", "arxiv", "web"]);
  });

  it("JobType", () => {
    // A type this enum lacks rejects the whole job list and takes every workspace page down.
    expect(JobTypeSchema.options).toEqual([
      "collection",
      "enrichment",
      "plan",
      "research",
      "trial",
    ]);
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
      status: "ready_local",
      peakMemoryGb: 40,
      requiredSecrets: ["HF_TOKEN"],
      preview: { id: "x", src: "/api/media/1" },
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("preview");
    expect(parsed).not.toHaveProperty("peakMemoryGb");
    expect(parsed).not.toHaveProperty("requiredSecrets");
  });

  it("refuses a platform from the Instagram era", () => {
    for (const platform of ["instagram", "threads", "linkedin"]) {
      expect(
        AIItemCardModelSchema.safeParse({
          id: "x",
          kind: "post",
          title: "x",
          source: { ...source, platform },
          summary: "",
          checkedAt: null,
        }).success,
      ).toBe(false);
    }
  });

  it("counts today's signals by kind, and nothing by board", () => {
    const parsed = SavedSummarySchema.parse({
      newItemCount: 5,
      kindCounts: { repo: 3, paper: 2 },
      sources: ["github", "huggingface"],
      href: "/library?day=2026-09-28",
      aiCount: 5,
      previews: [],
    });
    expect(parsed).not.toHaveProperty("aiCount");
    expect(parsed).not.toHaveProperty("previews");
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
      title: "Hugging Face 수집",
      steps: [{ id: "s1", label: "업보트한 논문 가져오기", state: "failed", message: "failed" }],
      cancellable: false,
    });
    expect(parsed.state).toBe("blocked");
  });
});

describe("manual item input", () => {
  it("accepts a user-authored web link without requiring fetched metadata", () => {
    expect(
      ManualItemCreateRequestSchema.parse({ url: "https://huggingface.co/datasets/a/b" }),
    ).toEqual({ url: "https://huggingface.co/datasets/a/b" });
  });

  it("rejects non-web schemes, and asks for no board", () => {
    expect(ManualItemCreateRequestSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      ManualItemCreateRequestSchema.parse({ url: "https://example.com", board: "music" }),
    ).not.toHaveProperty("board");
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
    general: {
      timezone: { value: "Asia/Seoul", origin: "file", effect: "immediate", editable: false },
      locale: { value: "ko-KR", origin: "file", effect: "immediate", editable: false },
      ceremonialEntry: {
        // `origin: "default"`: the shipped example never names it, because this screen is
        // where it is meant to be written.
        value: "full",
        origin: "default",
        effect: "immediate",
        editable: true,
        options: ["full", "brief", "skip"],
      },
    },
  });

  it("pins the three origins a value can have", () => {
    // The whole screen is this union. `file` and `default` are not interchangeable —
    // `ceremonial_entry` is absent from the shipped example and reaches the user as a
    // pydantic field default instead.
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

  it("drops the sections the Instagram era sent", () => {
    // Removed on 2026-09-28: the flags for collectors never built ("아직 없는 설정"), a debug
    // retention only a browser collector read, and per-source switches that stopped nothing.
    const parsed = SettingsDocumentSchema.parse({
      ...settingsDocument(),
      privacy: {},
      features: {},
      sources: [],
    });
    expect(parsed).not.toHaveProperty("privacy");
    expect(parsed).not.toHaveProperty("features");
    expect(parsed).not.toHaveProperty("sources");
    expect(
      SettingsPatchRequestSchema.safeParse({ changes: { "features.linkedinCollector": true } })
        .success,
    ).toBe(false);
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

  it("accepts a patch that names one key out of eight", () => {
    // Partial by construction: a body is what changed, not the document restated. An
    // exhaustive record would force the client to echo seven values it never touched.
    const parsed = SettingsPatchRequestSchema.parse({
      changes: { "collection.allowManualRefresh": false },
    });
    expect(Object.keys(parsed.changes)).toEqual(["collection.allowManualRefresh"]);
  });
});
