import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  boardViewHref,
  clearFiltersHref,
  itemDetailHref,
  isUnfiltered,
  parseAIFilters,
  safeBoardReturnHref,
  toggleFilterHref,
  unknownFilterValues,
} from "@/lib/filters/board-filters";

/**
 * These URLs get bookmarked and shared, so the parser's job is to be unbreakable and its
 * output to be boring: a link from six months ago still opens the Inbox, and no personal
 * data was ever in the link to begin with.
 */

describe("parsing", () => {
  it("reads a filtered Inbox", () => {
    const filters = parseAIFilters({ kind: "repo,paper" });
    expect(filters.kind).toEqual(["repo", "paper"]);
  });

  it("defaults an unfiltered Inbox", () => {
    const filters = parseAIFilters({});
    expect(isUnfiltered(filters)).toBe(true);
    expect(filters.sort).toBe("newest");
    expect(filters.density).toBe("cards");
  });

  it("survives a stale bookmark instead of throwing", () => {
    // The kebab-case spelling the docs used before the vocabulary was settled, a sort that
    // was retired, and a kind and a platform that went with Instagram.
    const filters = parseAIFilters({
      kind: "re-po,repo,outfit",
      source: "instagram,github",
      sort: "price_asc",
    });
    expect(filters.kind).toEqual(["repo"]);
    expect(filters.source).toEqual(["github"]);
    expect(filters.sort).toBe("newest");
  });

  it("reports what it dropped, rather than silently showing everything", () => {
    // An Inbox that quietly ignores the filter looks like the filter matched everything.
    expect(unknownFilterValues({ kind: "re-po", source: "threads" })).toEqual([
      "kind=re-po",
      "source=threads",
    ]);
    expect(unknownFilterValues({ kind: "repo" })).toEqual([]);
  });

  it("tolerates a repeated key even though that is not the grammar", () => {
    expect(parseAIFilters({ source: ["github", "huggingface"] }).source).toEqual(["github"]);
  });

  it("reads the day the rail's calendar picked", () => {
    // A local calendar day, single-valued. The value is a date, not an id or a handle —
    // the same one already printed on every card.
    expect(parseAIFilters({ day: "2026-08-08" }).day).toBe("2026-08-08");
    expect(parseAIFilters({}).day).toBeNull();
  });

  it("drops a day that is not a day, rather than filtering on it", () => {
    // Shape *and* calendar: `2026-02-30` matches the pattern and is not a date.
    expect(parseAIFilters({ day: "2026-13-40" }).day).toBeNull();
    expect(parseAIFilters({ day: "2026-02-30" }).day).toBeNull();
    expect(parseAIFilters({ day: "yesterday" }).day).toBeNull();
    expect(unknownFilterValues({ day: "2026-13-40" })).toEqual(["day=2026-13-40"]);
    expect(unknownFilterValues({ day: "2026-08-08" })).toEqual([]);
  });

  it("counts a day as one active filter, and calls the Inbox filtered", () => {
    const filters = parseAIFilters({ day: "2026-08-08" });
    expect(isUnfiltered(filters)).toBe(false);
    expect(activeFilterCount(filters)).toBe(1);
    expect(activeFilterCount(parseAIFilters({ source: "github", day: "2026-08-08" }))).toBe(2);
  });

  it("counts what is active across every group", () => {
    expect(activeFilterCount(parseAIFilters({ source: "github,huggingface", kind: "paper" }))).toBe(
      3,
    );
    expect(activeFilterCount(parseAIFilters({}))).toBe(0);
  });
});

describe("toggleFilterHref", () => {
  it("adds a value that is not selected", () => {
    expect(toggleFilterHref("/library", {}, "kind", "repo")).toBe("/library?kind=repo");
  });

  it("removes a value that is", () => {
    const params = { kind: "repo,paper" };
    expect(toggleFilterHref("/library", params, "kind", "paper")).toBe("/library?kind=repo");
  });

  it("returns the bare path when the last filter comes off", () => {
    // The canonical URL of an unfiltered Inbox has no query string at all.
    expect(toggleFilterHref("/library", { kind: "repo" }, "kind", "repo")).toBe("/library");
  });

  it("keeps the other groups intact", () => {
    const href = toggleFilterHref("/library", { source: "github", kind: "repo" }, "kind", "paper");
    expect(href).toContain("kind=repo%2Cpaper");
    expect(href).toContain("source=github");
  });

  it("carries a non-default view through a filter change", () => {
    const href = toggleFilterHref("/library", { density: "compact" }, "kind", "repo");
    expect(href).toContain("density=compact");
  });

  it("never writes a default into a shared link", () => {
    const href = toggleFilterHref(
      "/library",
      { sort: "newest", density: "cards" },
      "source",
      "github",
    );
    expect(href).toBe("/library?source=github");
  });

  it("round-trips through the parser", () => {
    const href = toggleFilterHref("/library", { source: "github" }, "source", "huggingface");
    const query = Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));
    expect(parseAIFilters(query).source).toEqual(["github", "huggingface"]);
  });
});

describe("toggleFilterHref in single mode", () => {
  /*
   * What the rail's source rows use: a list of places to go, where one click means "show me
   * this one" — so a row that quietly added to a set would promise one thing and do another.
   */
  it("replaces the group rather than adding to it", () => {
    const href = toggleFilterHref(
      "/library",
      { source: "github" },
      "source",
      "huggingface",
      "single",
    );
    expect(href).toBe("/library?source=huggingface");
  });

  it("discards a multi-value selection that arrived from a shared link", () => {
    const params = { source: "github,arxiv,web" };
    expect(toggleFilterHref("/library", params, "source", "huggingface", "single")).toBe(
      "/library?source=huggingface",
    );
  });

  it("clears the group when the row that is already on is clicked", () => {
    // The way back to the whole Inbox, without hunting for 필터 지우기.
    expect(toggleFilterHref("/library", { source: "github" }, "source", "github", "single")).toBe(
      "/library",
    );
  });

  it("clears the day when the selected day is clicked again", () => {
    expect(toggleFilterHref("/library", { day: "2026-08-08" }, "day", "2026-08-08", "single")).toBe(
      "/library",
    );
    expect(toggleFilterHref("/library", { day: "2026-08-08" }, "day", "2026-08-10", "single")).toBe(
      "/library?day=2026-08-10",
    );
  });

  it("carries the calendar's month and the day through every other toggle", () => {
    // `cal` is view state — which month the rail is drawing — so a source click must not
    // silently page the calendar back to where it started.
    const href = toggleFilterHref(
      "/library",
      { day: "2026-08-08", cal: "2026-08" },
      "source",
      "github",
    );
    expect(href).toContain("day=2026-08-08");
    expect(href).toContain("cal=2026-08");
    expect(href).toContain("source=github");
  });

  it("still accumulates in the default mode, which the chips use", () => {
    expect(toggleFilterHref("/library", { source: "github" }, "source", "huggingface")).toBe(
      "/library?source=github%2Chuggingface",
    );
  });
});

describe("clearFiltersHref", () => {
  it("drops every filter, the day and the calendar's month with it", () => {
    // `cal` goes with the filters rather than with `sort`: it is the calendar's view of a
    // filter that is being cleared.
    expect(
      clearFiltersHref("/library", { source: "github", day: "2026-08-08", cal: "2026-08" }),
    ).toBe("/library");
  });

  it("keeps how the user is looking at the Inbox", () => {
    // Clearing a filter is not a request to change the view.
    expect(clearFiltersHref("/library", { kind: "repo", density: "compact" })).toBe(
      "/library?density=compact",
    );
  });
});

describe("item detail return navigation", () => {
  it("carries the Inbox's filters through the detail link", () => {
    const inbox = boardViewHref("/library", {
      kind: "paper",
      source: "huggingface",
      day: "2026-08-08",
    });
    const href = itemDetailHref("paper-1", inbox);
    const from = new URLSearchParams(href.split("?")[1] ?? "").get("from");

    expect(from).toBe("/library?kind=paper&source=huggingface&day=2026-08-08");
    expect(safeBoardReturnHref(from, "/library")).toBe(from);
  });

  it("refuses external, unknown and removed return destinations", () => {
    expect(safeBoardReturnHref("https://example.com/library?source=github", "/library")).toBe(
      "/library",
    );
    expect(safeBoardReturnHref("/settings?source=github", "/library")).toBe("/library");
    // A detail link bookmarked from one of the boards that went with Instagram.
    expect(safeBoardReturnHref("/trends?kind=repo", "/library")).toBe("/library");
  });

  it("drops query keys that are not Inbox state", () => {
    expect(safeBoardReturnHref("/library?source=github&private-caption=secret", "/library")).toBe(
      "/library?source=github",
    );
  });

  it("drops free text disguised as a known filter", () => {
    expect(safeBoardReturnHref("/library?source=private-caption", "/library")).toBe("/library");
    expect(boardViewHref("/library", { kind: "repo", source: "private-caption" })).toBe(
      "/library?kind=repo",
    );
  });
});

describe("what never reaches the URL", () => {
  it("encodes only enum literals, never free text", () => {
    // Descriptions and handles are the source's words; a shared link must not carry them.
    const href = toggleFilterHref(
      "/library",
      { caption: "여름에 만든 에이전트", owner: "sample-org" },
      "kind",
      "repo",
    );
    expect(href).not.toContain("에이전트");
    expect(href).not.toContain("sample-org");
  });
});

describe("every parsed filter is actually applied", () => {
  /**
   * The failure this guards against is specific and was live: a filter parsed correctly,
   * was never passed to the repository, and the list answered with items contradicting its
   * own URL — worse than returning nothing, because nothing at least looks like a filter.
   */
  it("gives the Inbox query a home for every filter group", async () => {
    const { MockRepository } = await import("@/lib/mock/repository");
    const repository = new MockRepository();

    const filters = parseAIFilters({ kind: "paper", source: "huggingface" });
    const page = await repository.listAIItems({
      limit: 200,
      kind: filters.kind,
      source: filters.source,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(
      page.items.every((item) => item.kind === "paper" && item.source.platform === "huggingface"),
    ).toBe(true);
  });

  it("returns nothing for a source no item has, rather than everything", async () => {
    const { MockRepository } = await import("@/lib/mock/repository");
    const page = await new MockRepository().listAIItems({ limit: 200, source: ["web"] });
    expect(page.items).toEqual([]);
  });
});
