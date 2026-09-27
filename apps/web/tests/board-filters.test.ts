import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  boardViewHref,
  clearFiltersHref,
  itemDetailHref,
  isUnfiltered,
  parseAIFilters,
  parseMusicFilters,
  parseStyleFilters,
  safeBoardReturnHref,
  toggleFilterHref,
  unknownFilterValues,
} from "@/lib/filters/board-filters";

/**
 * These URLs get bookmarked and shared, so the parser's job is to be unbreakable and its
 * output to be boring: a link from six months ago still opens the board, and no personal
 * data was ever in the link to begin with.
 */

describe("parsing", () => {
  it("reads a filtered board", () => {
    const filters = parseAIFilters({ kind: "repo,post" });
    expect(filters.kind).toEqual(["repo", "post"]);
  });

  it("defaults an unfiltered board", () => {
    const filters = parseAIFilters({});
    expect(isUnfiltered(filters)).toBe(true);
    expect(filters.sort).toBe("newest");
    expect(filters.density).toBe("cards");
  });

  it("survives a stale bookmark instead of throwing", () => {
    // The kebab-case spelling the docs used before the vocabulary was settled.
    const filters = parseAIFilters({ kind: "re-po,repo", sort: "recent" });
    expect(filters.kind).toEqual(["repo"]);
    expect(filters.sort).toBe("newest");
  });

  it("reports what it dropped, rather than silently showing everything", () => {
    // A board that quietly ignores the filter looks like the filter matched everything.
    expect(unknownFilterValues({ kind: "re-po", source: "in-sta" })).toEqual([
      "kind=re-po",
      "source=in-sta",
    ]);
    expect(unknownFilterValues({ kind: "repo" })).toEqual([]);
  });

  it("tolerates a repeated key even though that is not the grammar", () => {
    expect(parseStyleFilters({ source: ["instagram", "threads"] }).source).toEqual(["instagram"]);
  });

  it("treats the music board as an inbox by default", () => {
    expect(parseMusicFilters({}).handled).toBe("hidden");
    expect(parseMusicFilters({ handled: "shown" }).handled).toBe("shown");
    expect(parseMusicFilters({ handled: "nonsense" }).handled).toBe("hidden");
  });

  it("reads the day the rail's calendar picked", () => {
    // A local calendar day, single-valued. The value is a date, not an id or a handle —
    // the same one already printed on every card.
    expect(parseAIFilters({ day: "2026-08-08" }).day).toBe("2026-08-08");
    expect(parseStyleFilters({}).day).toBeNull();
    expect(parseMusicFilters({ day: "2026-08-10" }).day).toBe("2026-08-10");
  });

  it("drops a day that is not a day, rather than filtering on it", () => {
    // Shape *and* calendar: `2026-02-30` matches the pattern and is not a date.
    expect(parseAIFilters({ day: "2026-13-40" }).day).toBeNull();
    expect(parseAIFilters({ day: "2026-02-30" }).day).toBeNull();
    expect(parseAIFilters({ day: "yesterday" }).day).toBeNull();
    expect(unknownFilterValues({ day: "2026-13-40" })).toEqual(["day=2026-13-40"]);
    expect(unknownFilterValues({ day: "2026-08-08" })).toEqual([]);
  });

  it("counts a day as one active filter, and calls the board filtered", () => {
    const filters = parseStyleFilters({ day: "2026-08-08" });
    expect(isUnfiltered(filters)).toBe(false);
    expect(activeFilterCount(filters)).toBe(1);
    expect(activeFilterCount(parseStyleFilters({ source: "instagram", day: "2026-08-08" }))).toBe(
      2,
    );
  });

  it("counts what is active across every group", () => {
    expect(activeFilterCount(parseStyleFilters({ source: "instagram,threads" }))).toBe(2);
    expect(activeFilterCount(parseStyleFilters({}))).toBe(0);
  });
});

describe("toggleFilterHref", () => {
  it("adds a value that is not selected", () => {
    expect(toggleFilterHref("/ai", {}, "kind", "repo")).toBe("/ai?kind=repo");
  });

  it("removes a value that is", () => {
    const params = { status: "ready_local,too_large" };
    expect(toggleFilterHref("/ai", params, "status", "too_large")).toBe("/ai?status=ready_local");
  });

  it("returns the bare path when the last filter comes off", () => {
    // The canonical URL of an unfiltered board has no query string at all.
    expect(toggleFilterHref("/ai", { status: "ready_local" }, "status", "ready_local")).toBe("/ai");
  });

  it("keeps the other groups intact", () => {
    const href = toggleFilterHref("/trends", { source: "instagram", kind: "post" }, "kind", "repo");
    expect(href).toContain("kind=post%2Crepo");
    expect(href).toContain("source=instagram");
  });

  it("carries a non-default sort through a filter change", () => {
    const href = toggleFilterHref("/style", { sort: "price_asc" }, "match", "exact");
    expect(href).toContain("sort=price_asc");
  });

  it("never writes a default into a shared link", () => {
    const href = toggleFilterHref(
      "/style",
      { sort: "newest", density: "cards" },
      "source",
      "instagram",
    );
    expect(href).toBe("/style?source=instagram");
  });

  it("round-trips through the parser", () => {
    const href = toggleFilterHref("/style", { source: "instagram" }, "source", "threads");
    const query = Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));
    expect(parseStyleFilters(query).source).toEqual(["instagram", "threads"]);
  });
});

describe("toggleFilterHref in single mode", () => {
  /*
   * What the rail's source rows use. They sit under "Browse by type" in the same panel and
   * in the same shape, and that block means "show me this one" — so a row that quietly
   * added to a set was promising one thing and doing another.
   */
  it("replaces the group rather than adding to it", () => {
    const href = toggleFilterHref("/trends", { source: "github" }, "source", "instagram", "single");
    expect(href).toBe("/trends?source=instagram");
  });

  it("discards a multi-value selection that arrived from a shared link", () => {
    const params = { source: "github,threads,linkedin" };
    expect(toggleFilterHref("/trends", params, "source", "instagram", "single")).toBe(
      "/trends?source=instagram",
    );
  });

  it("clears the group when the row that is already on is clicked", () => {
    // The way back to the whole board, without hunting for 필터 지우기.
    expect(toggleFilterHref("/trends", { source: "github" }, "source", "github", "single")).toBe(
      "/trends",
    );
  });

  it("leaves every other key alone", () => {
    const href = toggleFilterHref(
      "/trends",
      { source: "github", sort: "price_asc" },
      "source",
      "threads",
      "single",
    );
    expect(href).toContain("sort=price_asc");
    expect(href).toContain("source=threads");
  });

  it("clears the day when the selected day is clicked again", () => {
    // With "필터 지우기" gone this is the way back to the whole board from the calendar.
    expect(toggleFilterHref("/trends", { day: "2026-08-08" }, "day", "2026-08-08", "single")).toBe(
      "/trends",
    );
    expect(toggleFilterHref("/trends", { day: "2026-08-08" }, "day", "2026-08-10", "single")).toBe(
      "/trends?day=2026-08-10",
    );
  });

  it("carries the calendar's month and the day through every other toggle", () => {
    // `cal` is view state — which month the rail is drawing — so a source click must not
    // silently page the calendar back to where it started.
    const href = toggleFilterHref(
      "/trends",
      { day: "2026-08-08", cal: "2026-08" },
      "source",
      "github",
    );
    expect(href).toContain("day=2026-08-08");
    expect(href).toContain("cal=2026-08");
    expect(href).toContain("source=github");
  });

  it("still accumulates in the default mode, which the chips use", () => {
    expect(toggleFilterHref("/trends", { source: "github" }, "source", "instagram")).toBe(
      "/trends?source=github%2Cinstagram",
    );
  });
});

describe("clearFiltersHref", () => {
  it("drops every filter", () => {
    // `sort` is a view setting, not a filter, and survives on purpose.
    expect(clearFiltersHref("/style", { source: "instagram" })).toBe("/style");
  });

  it("drops the day and the calendar's month with it", () => {
    // `cal` goes with the filters rather than with `sort`: it is the calendar's view of a
    // filter that is being cleared, and keeping it would leave the rail pointing at a month
    // the person is no longer looking at.
    expect(clearFiltersHref("/trends", { day: "2026-08-08", cal: "2026-08" })).toBe("/trends");
  });

  it("keeps how the user is looking at the board", () => {
    // Clearing a filter is not a request to change the view.
    expect(clearFiltersHref("/style", { match: "exact", density: "compact" })).toBe(
      "/style?density=compact",
    );
  });
});

describe("item detail return navigation", () => {
  it("carries the board type and source filter through the detail link", () => {
    const board = boardViewHref("/trends", {
      kind: "post",
      source: "instagram",
      day: "2026-08-08",
    });
    const href = itemDetailHref("post-1", board);
    const from = new URLSearchParams(href.split("?")[1] ?? "").get("from");

    expect(from).toBe("/trends?kind=post&source=instagram&day=2026-08-08");
    expect(safeBoardReturnHref(from, "/trends")).toBe(from);
  });

  it("refuses external and unknown return destinations", () => {
    expect(safeBoardReturnHref("https://example.com/trends?source=instagram", "/trends")).toBe(
      "/trends",
    );
    expect(safeBoardReturnHref("/settings?source=instagram", "/style")).toBe("/style");
  });

  it("drops query keys that are not board state", () => {
    expect(
      safeBoardReturnHref("/library?source=instagram&private-caption=secret", "/library"),
    ).toBe("/library?source=instagram");
  });

  it("drops free text disguised as a known filter", () => {
    expect(safeBoardReturnHref("/library?source=private-caption", "/library")).toBe("/library");
    expect(boardViewHref("/trends", { kind: "post", source: "private-caption" })).toBe(
      "/trends?kind=post",
    );
  });
});

describe("what never reaches the URL", () => {
  it("encodes only enum literals, never free text", () => {
    // Captions and handles are personal data; a shared board link must not carry them.
    const href = toggleFilterHref(
      "/style",
      { match: "exact", caption: "여름에 이렇게 입고 나갔다가", owner: "sample_owner" },
      "stock",
      "available",
    );
    expect(href).not.toContain("카페");
    expect(href).not.toContain("sample_owner");
  });
});

describe("every parsed filter is actually applied", () => {
  /**
   * The failure this guards against is specific and was live: `?source=github` on /ai
   * parsed correctly, was never passed to the repository, and the board answered with
   * nine Instagram items. A filter that returns results contradicting its own URL is
   * worse than one that returns nothing, because nothing at least looks like a filter.
   */
  it("gives the AI query a home for every AI filter group", async () => {
    const { MockRepository } = await import("@/lib/mock/repository");
    const repository = new MockRepository();

    // If a group exists in the parser, the repository must accept it. Adding a group
    // without a query argument makes this fail to compile.
    const filters = parseAIFilters({ kind: "post", source: "instagram" });
    const page = await repository.listAIItems({
      limit: 200,
      kind: filters.kind,
      source: filters.source,
    });
    expect(page.items.every((item) => item.source.platform === "instagram")).toBe(true);
  });

  it("gives the Style query a home for every Style filter group", async () => {
    const { MockRepository } = await import("@/lib/mock/repository");
    const repository = new MockRepository();

    const filters = parseStyleFilters({ match: "unknown", stock: "unknown", source: "instagram" });
    const page = await repository.listStyleItems({
      limit: 200,
      source: filters.source,
    });
    expect(page.items.every((item) => item.source.platform === "instagram")).toBe(true);
  });

  it("returns nothing for a source no item has, rather than everything", async () => {
    const { MockRepository } = await import("@/lib/mock/repository");
    const repository = new MockRepository();

    const page = await repository.listAIItems({ limit: 200, source: ["linkedin"] });
    expect(page.items).toEqual([]);
  });
});
