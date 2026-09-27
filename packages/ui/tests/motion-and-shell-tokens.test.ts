import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/theme/color";
import { THEMES } from "../src/theme/theme-registry";

/**
 * Tokens that DESIGN.md mandates literally, and that a component would otherwise be
 * forced to hard-code. Every assertion here exists because its absence produced a real
 * defect: a magic-number duration, an invisible focus ring, or an unimplementable
 * tablet inset.
 */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), "utf8");

describe("interaction timing tokens (DESIGN.md §14)", () => {
  const css = read("motion.css");

  it.each([
    ["--duration-fast", "120ms"],
    ["--duration-default", "180ms"],
    ["--duration-slow", "280ms"],
  ])("defines %s as %s", (token, value) => {
    expect(css).toContain(`${token}: ${value};`);
  });

  it("defines the standard easing curve", () => {
    expect(css).toContain("--ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1);");
  });

  it("keeps scene durations separate from interaction durations", () => {
    // A 700ms crossfade on a 26px chip is the failure this separation prevents.
    expect(css).toContain("--duration-scene-forward: 760ms;");
    expect(css).toContain("--duration-fast: 120ms;");
  });
});

describe("shell geometry tokens (DESIGN.md §6, §19)", () => {
  const css = read("tokens.css");

  it.each([
    ["--shell-inset-tablet", "8px"],
    ["--shell-inset-desktop", "12px"],
    ["--shell-inset-wide", "16px"],
  ])("defines %s as %s", (token, value) => {
    expect(css).toContain(`${token}: ${value};`);
  });

  it("keeps the tablet inset inside the documented 6–8px range", () => {
    const match = /--shell-inset-tablet: (\d+)px;/.exec(css);
    const value = Number(match?.[1]);
    expect(value).toBeGreaterThanOrEqual(6);
    expect(value).toBeLessThanOrEqual(8);
  });
});

describe("focus ring (DESIGN.md §13)", () => {
  const css = read("globals.css");

  it("uses the documented rule verbatim", () => {
    expect(css).toContain("outline: 2px solid var(--focus-ring);");
    expect(css).toContain("outline-offset: 3px;");
  });

  it("provides a high-contrast ring for inverse and scenic grounds", () => {
    expect(css).toContain("outline-color: var(--focus-ring-contrast);");
  });

  it.each(THEMES)("$id keeps the ring perceivable on content surfaces", (theme) => {
    // WCAG 2.2 non-text contrast: 3:1.
    for (const ground of [theme.tokens.surface, theme.tokens.surface2, theme.tokens.shell]) {
      expect(
        contrastRatio(theme.tokens.focusRing, ground),
        `${theme.id}: ${theme.tokens.focusRing} on ${ground}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)("$id keeps the paired ring perceivable on the inverse ground", (theme) => {
    // The dark capsule Button is the case that made this token necessary.
    expect(
      contrastRatio(theme.tokens.focusRingContrast, theme.tokens.inverse),
      `${theme.id}: ${theme.tokens.focusRingContrast} on ${theme.tokens.inverse}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)("$id does not confuse the ring with the --focus surface tint", (theme) => {
    // `--focus` is a pale selected-state background, not a ring colour.
    expect(theme.tokens.focusRing).not.toBe(theme.tokens.focus);
  });
});

describe("hit target utility (DESIGN.md §18)", () => {
  it("expands the target without changing layout", () => {
    const css = read("globals.css");
    expect(css).toContain(".hit-44");
    expect(css).toContain("width: max(100%, 44px);");
    expect(css).toContain("height: max(100%, 44px);");
  });
});
