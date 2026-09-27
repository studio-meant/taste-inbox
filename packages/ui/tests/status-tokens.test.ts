import { describe, expect, it } from "vitest";
import { contrastRatio, ensureContrast, relativeLuminance } from "../src/theme/color";
import { THEMES } from "../src/theme/theme-registry";
import { STATUS_TOKENS, STATUS_TONES } from "../src/theme/tokens";

/**
 * Semantic status colours, DESIGN.md §7 "Semantic status" and §18 Accessibility.
 *
 * The specification defines these against its lavender baseline; the seven shipped
 * palettes are green and cream, so the values are derived per theme. These tests are
 * what make the derivation trustworthy — 7 themes x 5 tones is 35 pairs, far too many
 * to eyeball.
 */

describe("ensureContrast", () => {
  it("leaves a colour alone when it already clears the target", () => {
    expect(ensureContrast("#000000", "#FFFFFF", "#000000")).toBe("#000000");
  });

  it("darkens toward the target colour until the ratio is met", () => {
    const result = ensureContrast("#DDDDDD", "#FFFFFF", "#000000");
    expect(contrastRatio(result, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(relativeLuminance(result)).toBeLessThan(relativeLuminance("#DDDDDD"));
  });

  it("stops at the first step that clears the target", () => {
    // Hue is preserved as far as the contrast obligation allows, so the result must
    // not be the ink itself when a lighter blend already passes.
    const result = ensureContrast("#FFFFFF", "#FFFFFF", "#111111");
    expect(contrastRatio(result, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(result).not.toBe("#111111");
    expect(relativeLuminance(result)).toBeGreaterThan(relativeLuminance("#111111"));
  });

  it("falls back to the target colour when even that cannot clear it", () => {
    // Blending white toward #EEEEEE never reaches 4.5:1 against white.
    expect(ensureContrast("#FFFFFF", "#FFFFFF", "#EEEEEE")).toBe("#EEEEEE");
  });

  it("honours a custom target", () => {
    const relaxed = ensureContrast("#999999", "#FFFFFF", "#000000", 3);
    expect(contrastRatio(relaxed, "#FFFFFF")).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic", () => {
    expect(ensureContrast("#A8B991", "#F4EFE5", "#2F2A25")).toBe(
      ensureContrast("#A8B991", "#F4EFE5", "#2F2A25"),
    );
  });
});

describe("semantic status tokens", () => {
  it.each(THEMES)("$id defines all five tone pairs", (theme) => {
    for (const tone of STATUS_TONES) {
      const { bg, fg } = STATUS_TOKENS[tone];
      expect(theme.tokens[bg], `${tone} bg`).toMatch(/^#[0-9A-F]{6}$/);
      expect(theme.tokens[fg], `${tone} fg`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each(THEMES)("$id keeps every status pair readable at WCAG AA", (theme) => {
    for (const tone of STATUS_TONES) {
      const { bg, fg } = STATUS_TOKENS[tone];
      const ratio = contrastRatio(theme.tokens[fg], theme.tokens[bg]);
      expect(
        ratio,
        `${theme.id} / ${tone} → ${theme.tokens[fg]} on ${theme.tokens[bg]}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)("$id keeps status backgrounds distinguishable from the card surface", (theme) => {
    // A tint that reads as the card itself communicates nothing.
    for (const tone of STATUS_TONES) {
      const { bg } = STATUS_TOKENS[tone];
      expect(theme.tokens[bg], tone).not.toBe(theme.tokens.surface);
    }
  });

  it.each(THEMES)("$id keeps ready, warning and danger visually distinct", (theme) => {
    // These three carry the decisions the user acts on, so they must not collapse
    // into each other even in the most neutral palettes.
    const backgrounds = [
      theme.tokens[STATUS_TOKENS.ready.bg],
      theme.tokens[STATUS_TOKENS.warning.bg],
      theme.tokens[STATUS_TOKENS.danger.bg],
    ];
    expect(new Set(backgrounds).size).toBe(3);

    const foregrounds = [
      theme.tokens[STATUS_TOKENS.ready.fg],
      theme.tokens[STATUS_TOKENS.warning.fg],
      theme.tokens[STATUS_TOKENS.danger.fg],
    ];
    expect(new Set(foregrounds).size).toBe(3);
  });

  it.each(THEMES)("$id gives neutral no hue of its own", (theme) => {
    // "Nothing to report" must not look like a state (DESIGN.md §7 Rules).
    expect(theme.tokens[STATUS_TOKENS.neutral.bg]).toBe(theme.tokens.surface2);
  });

  it("never uses the raw signal hues directly as status", () => {
    // DESIGN.md §7 Rules: status uses the semantic palette, not the signal palette.
    for (const theme of THEMES) {
      expect(theme.tokens[STATUS_TOKENS.warning.fg]).not.toBe(theme.tokens.warning);
      expect(theme.tokens[STATUS_TOKENS.danger.fg]).not.toBe(theme.tokens.danger);
    }
  });
});
