import type { AIItemCardModel, StyleItemCardModel } from "@taste-inbox/shared";
import { describe, expect, it } from "vitest";
import { aiFilterGroups, styleFilterGroups } from "@/lib/filters/facets";

/**
 * A filter group is offered only when it can actually separate the board.
 *
 * This is the honesty rule applied to controls rather than to values: a `Category` group
 * over 76 items that were never classified would return nothing every time, and "no
 * matches" reads as a fact about the items when it is really a fact about the product.
 */

const SOURCE = {
  platform: "instagram",
  label: "Instagram Saved",
  originalUrl: "https://www.instagram.com/reel/AAA/",
  author: "someone",
  actionType: "save",
  firstSeenAt: "2026-08-08T00:00:00.000Z",
} as const;

function ai(overrides: Partial<AIItemCardModel> = {}): AIItemCardModel {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "post",
    title: "제목",
    summary: "요약",
    status: "unknown",
    whyItMatters: null,
    peakMemoryGb: null,
    diskGb: null,
    supportsArm64: null,
    compatibility: null,
    checkedAt: null,
    source: SOURCE,
    tags: [],
    preview: null,
    ...overrides,
  } as AIItemCardModel;
}

function style(overrides: Partial<StyleItemCardModel> = {}): StyleItemCardModel {
  return {
    id: Math.random().toString(36).slice(2),
    descriptor: "설명",
    brand: null,
    productName: null,
    currentPrice: null,
    originalPrice: null,
    matchGrade: "unknown",
    stockState: "unknown",
    retailerCount: 0,
    checkedAt: null,
    source: SOURCE,
    tags: [],
    media: [],
    ...overrides,
  } as StyleItemCardModel;
}

describe("when nothing has been enriched", () => {
  it("offers no filters at all on the Style board", () => {
    // This is today's real state: 76 collected items, every one unknown/unknown/instagram.
    const items = Array.from({ length: 76 }, () => style());
    expect(styleFilterGroups(items)).toEqual([]);
  });

  it("offers no filters at all on the AI board", () => {
    const items = Array.from({ length: 9 }, () => ai());
    expect(aiFilterGroups(items)).toEqual([]);
  });
});

describe("once the data can separate the board", () => {
  it("offers the group that now has more than one value", () => {
    // The Style board's only axis is where the item came from — the product axes went
    // with the product resolver (docs/DECISIONS.md, 2026-08-09).
    const items = [
      style({ source: { ...SOURCE, platform: "instagram" } }),
      style({ source: { ...SOURCE, platform: "threads" } }),
      style({ source: { ...SOURCE, platform: "threads" } }),
    ];
    const groups = styleFilterGroups(items);

    expect(groups.map((group) => group.key)).toEqual(["source"]);
  });

  it("counts each option against the whole board", () => {
    const items = [
      style({ source: { ...SOURCE, platform: "instagram" } }),
      style({ source: { ...SOURCE, platform: "threads" } }),
      style({ source: { ...SOURCE, platform: "threads" } }),
    ];
    const counts = (styleFilterGroups(items)[0]?.options ?? []).map((option) => option.count);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(3);
  });
});

describe("when the board has more than one kind of thing on it", () => {
  it("offers 출처 and never 종류, because the platform already says which is which", () => {
    /*
     * 저장소 is only ever GitHub and 게시물 is only ever a social platform — `kind` is
     * assigned *from* the platform at ingest — so a 종류 group was a second control over
     * one distinction, and the derived half of it at that.
     *
     * The old shape would have returned two groups here. Nothing asserted that, which is
     * why removing it broke no test: every item in the tests above is `kind: "post"`, so
     * the group never appeared in one.
     */
    const items = [
      ...Array.from({ length: 6 }, () =>
        ai({ kind: "repo", source: { ...SOURCE, platform: "github" } }),
      ),
      ...Array.from({ length: 25 }, () => ai({ kind: "post" })),
    ];

    expect(aiFilterGroups(items).map((group) => group.key)).toEqual(["source"]);
  });
});
