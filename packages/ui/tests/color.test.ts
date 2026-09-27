import { describe, expect, it } from "vitest";
import { contrastRatio, mix, parseHex, relativeLuminance, toHex } from "../src/theme/color";

describe("parseHex / toHex", () => {
  it("round-trips a colour", () => {
    expect(toHex(parseHex("#A8B991"))).toBe("#A8B991");
  });

  it("normalises case", () => {
    expect(toHex(parseHex("#a8b991"))).toBe("#A8B991");
  });

  it("rejects shorthand and malformed input", () => {
    expect(() => parseHex("#abc")).toThrow();
    expect(() => parseHex("rgba(0,0,0,.1)")).toThrow();
    expect(() => parseHex("")).toThrow();
  });

  it("clamps out-of-range channels", () => {
    expect(toHex({ r: -20, g: 300, b: 128 })).toBe("#00FF80");
  });
});

describe("mix", () => {
  it("returns the first colour at full weight", () => {
    expect(mix("#B97E5D", "#F4EFE5", 1)).toBe("#B97E5D");
  });

  it("returns the second colour at zero weight", () => {
    expect(mix("#B97E5D", "#F4EFE5", 0)).toBe("#F4EFE5");
  });

  it("blends channel-wise", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  it("rejects a weight outside the unit interval", () => {
    expect(() => mix("#000000", "#FFFFFF", 1.5)).toThrow();
    expect(() => mix("#000000", "#FFFFFF", -0.1)).toThrow();
    expect(() => mix("#000000", "#FFFFFF", Number.NaN)).toThrow();
  });
});

describe("relativeLuminance / contrastRatio", () => {
  it("orders black below white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("computes the maximum contrast ratio", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#2F2A25", "#FFFDF8")).toBeCloseTo(
      contrastRatio("#FFFDF8", "#2F2A25"),
      10,
    );
  });
});
