import {
  DEFAULT_DENSITY,
  DEFAULT_SORT,
  DensitySchema,
  ItemKindSchema,
  SortOrderSchema,
  SourcePlatformSchema,
  parseMultiValue,
  serializeMultiValue,
} from "../src";
import { describe, expect, it } from "vitest";

/**
 * The URL filter vocabulary is a public interface — these strings end up in bookmarks and
 * shared links. The property under test is that a URL value and a schema value are the
 * same string, because that is what removes the translation layer entirely.
 */

describe("URL vocabulary", () => {
  it("is snake_case with no hyphens anywhere", () => {
    const every = [
      ...SortOrderSchema.options,
      ...DensitySchema.options,
      ...ItemKindSchema.options,
      ...SourcePlatformSchema.options,
    ];
    for (const value of every) {
      expect(value).not.toContain("-");
      expect(value).toBe(value.toLowerCase());
    }
  });

  it("retires `recent` in favour of `newest`", () => {
    expect(SortOrderSchema.options).toContain("newest");
    expect(SortOrderSchema.options).not.toContain("recent");
    // The price orders went with the Style board.
    expect(SortOrderSchema.options).toEqual(["newest", "relevance"]);
    expect(DEFAULT_SORT).toBe("newest");
    expect(DEFAULT_DENSITY).toBe("cards");
  });
});

describe("parseMultiValue", () => {
  it("reads a comma-separated list", () => {
    expect(parseMultiValue("paper,repo", ItemKindSchema)).toEqual(["paper", "repo"]);
  });

  it("treats a missing or empty key as no filter", () => {
    expect(parseMultiValue(null, ItemKindSchema)).toEqual([]);
    expect(parseMultiValue(undefined, ItemKindSchema)).toEqual([]);
    expect(parseMultiValue("", ItemKindSchema)).toEqual([]);
  });

  it("drops an unknown value instead of throwing", () => {
    // A bookmark saved before an enum changed should still open the board.
    // `outfit` is a kind from before 2026-09-28 — exactly the stale bookmark in question.
    expect(parseMultiValue("paper,outfit,nonsense", ItemKindSchema)).toEqual(["paper"]);
  });

  it("tolerates whitespace and collapses duplicates while keeping order", () => {
    expect(parseMultiValue("repo, paper ,repo", ItemKindSchema)).toEqual(["repo", "paper"]);
  });

  it("round-trips", () => {
    const values = parseMultiValue("paper,repo", ItemKindSchema);
    expect(serializeMultiValue(values)).toBe("paper,repo");
  });
});

describe("serializeMultiValue", () => {
  it("returns null for nothing selected, so the caller deletes the key", () => {
    // `?status=` reads as an active filter that matches nothing.
    expect(serializeMultiValue([])).toBeNull();
  });
});
