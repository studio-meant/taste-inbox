import {
  DEFAULT_DENSITY,
  DEFAULT_SORT,
  DensitySchema,
  SortOrderSchema,
  StyleMatchGradeSchema,
  StyleStockStateSchema,
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
      ...StyleMatchGradeSchema.options,
      ...StyleStockStateSchema.options,
    ];
    for (const value of every) {
      expect(value).not.toContain("-");
      expect(value).toBe(value.toLowerCase());
    }
  });

  it("uses the values the docs were corrected to", () => {
    // IA_WIREFRAMES said `in-stock`, which was in no enum under any casing.
    expect(StyleStockStateSchema.options).toContain("available");
    expect(StyleStockStateSchema.options).not.toContain("in_stock");
  });

  it("retires `recent` in favour of `newest`", () => {
    expect(SortOrderSchema.options).toContain("newest");
    expect(SortOrderSchema.options).not.toContain("recent");
    expect(DEFAULT_SORT).toBe("newest");
    expect(DEFAULT_DENSITY).toBe("cards");
  });
});

describe("parseMultiValue", () => {
  it("reads a comma-separated list", () => {
    expect(parseMultiValue("exact,similar", StyleMatchGradeSchema)).toEqual(["exact", "similar"]);
  });

  it("treats a missing or empty key as no filter", () => {
    expect(parseMultiValue(null, StyleMatchGradeSchema)).toEqual([]);
    expect(parseMultiValue(undefined, StyleMatchGradeSchema)).toEqual([]);
    expect(parseMultiValue("", StyleMatchGradeSchema)).toEqual([]);
  });

  it("drops an unknown value instead of throwing", () => {
    // A bookmark saved before an enum changed should still open the board.
    expect(parseMultiValue("exact,ex-act,nonsense", StyleMatchGradeSchema)).toEqual(["exact"]);
  });

  it("tolerates whitespace and collapses duplicates while keeping order", () => {
    expect(parseMultiValue("similar, exact ,similar", StyleMatchGradeSchema)).toEqual([
      "similar",
      "exact",
    ]);
  });

  it("round-trips", () => {
    const values = parseMultiValue("exact,similar", StyleMatchGradeSchema);
    expect(serializeMultiValue(values)).toBe("exact,similar");
  });
});

describe("serializeMultiValue", () => {
  it("returns null for nothing selected, so the caller deletes the key", () => {
    // `?status=` reads as an active filter that matches nothing.
    expect(serializeMultiValue([])).toBeNull();
  });
});
