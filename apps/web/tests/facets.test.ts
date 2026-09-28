import type { AIItemCardModel } from "@taste-inbox/shared";
import { describe, expect, it } from "vitest";
import { aiFilterGroups } from "@/lib/filters/facets";

/**
 * A filter group is offered only when it can actually separate the board.
 *
 * This is the honesty rule applied to controls rather than to values: a group over a value
 * every item shares would answer every click with the same list, and "no matches" reads as
 * a fact about the items when it is really a fact about the product.
 */

const SOURCE = {
  platform: "github",
  label: "GitHub",
  originalUrl: "https://github.com/sample-org/a",
  author: "sample-org",
  actionType: "star",
  firstSeenAt: "2026-08-08T00:00:00.000Z",
} as const;

function ai(overrides: Partial<AIItemCardModel> = {}): AIItemCardModel {
  return {
    id: Math.random().toString(36).slice(2),
    kind: "repo",
    title: "제목",
    summary: "요약",
    checkedAt: null,
    source: SOURCE,
    tags: [],
    links: [],
    ...overrides,
  };
}

describe("when every item is the same", () => {
  it("offers no filters at all", () => {
    const items = Array.from({ length: 9 }, () => ai());
    expect(aiFilterGroups(items)).toEqual([]);
  });
});

describe("once the data can separate the Inbox", () => {
  it("offers 출처 when the items came from more than one place", () => {
    const items = [
      ai(),
      ai({ kind: "repo", source: { ...SOURCE, platform: "web" } }),
      ai({ kind: "repo", source: { ...SOURCE, platform: "web" } }),
    ];
    const groups = aiFilterGroups(items);

    expect(groups.map((group) => group.key)).toEqual(["source"]);
    const counts = (groups[0]?.options ?? []).map((option) => option.count);
    expect(counts.reduce((total, count) => total + count, 0)).toBe(3);
  });
});

describe("when the board has more than one kind of thing on it", () => {
  it("offers 출처 and never 종류 when each source yields one kind", () => {
    // Repo is only ever GitHub here and Post only ever the web, so a 종류 group would be a
    // second control over one distinction.
    const items = [
      ...Array.from({ length: 6 }, () => ai({ kind: "repo" })),
      ...Array.from({ length: 4 }, () =>
        ai({ kind: "post", source: { ...SOURCE, platform: "web" } }),
      ),
    ];

    expect(aiFilterGroups(items).map((group) => group.key)).toEqual(["source"]);
  });

  it("offers 종류 again once one source yields several kinds (2026-09-28)", () => {
    /*
     * Hugging Face likes are models, datasets and Spaces, and the papers they cite come
     * from the same source. Kind is no longer a function of source, so it earns its own
     * group — counted, like every facet here.
     */
    const hf = { ...SOURCE, platform: "huggingface" as const };
    const items = [
      ...Array.from({ length: 4 }, () =>
        ai({ kind: "repo", source: { ...SOURCE, platform: "github" } }),
      ),
      ai({ kind: "dataset", source: hf }),
      ai({ kind: "dataset", source: hf }),
      ai({ kind: "space", source: hf }),
      ai({ kind: "paper", source: hf }),
    ];

    const groups = aiFilterGroups(items);
    expect(groups.map((group) => group.key)).toEqual(["kind", "source"]);
    expect(groups[0]?.options).toEqual([
      { value: "repo", label: "Repo", count: 4 },
      { value: "dataset", label: "Dataset", count: 2 },
      { value: "space", label: "Space", count: 1 },
      { value: "paper", label: "Paper", count: 1 },
    ]);
  });
});
