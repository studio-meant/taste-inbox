import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../src/theme/color";
import { THEMES } from "../src/theme/theme-registry";
import type { ThemeTokenName } from "../src/theme/tokens";

/**
 * Body-copy contrast across the seven palettes — DESIGN.md §18: "최소 WCAG 2.2 AA",
 * "일반 텍스트 contrast 4.5:1 이상".
 *
 * `--subtle` shipped below that bar in all seven themes at once: 3.20 / 3.02 / 2.88 /
 * 2.73 / 2.96 / 3.02 / 2.65 on `--surface`, and 2.20–2.75 on the deepest ground. Most of
 * those do not even clear the 3:1 non-text floor. It is not a decorative token — ~31 call
 * sites paint 11–13px copy with it, including the empty-state description, which is the
 * only text on screen when it shows, and the Music card's raw observed string that
 * DESIGN.md §3.5 treats as load-bearing. Nothing tested it: before this file, grepping
 * for `subtle` across every test directory in the repo returned no hits at all.
 *
 * `muted` is held to the same 4.5 here, which is stricter than the 3:1 large-text claim
 * in theme-registry.test.ts. That is arithmetic rather than taste: `subtle` owes 4.5 on
 * the same grounds and must stay lighter than `muted`, so `muted` clears 4.5 or the ramp
 * inverts. Four themes' ported `muted` did not (4.45 / 4.05 / 4.01 / 3.49 on `surface3`)
 * and were retuned in palettes.ts alongside `subtle`.
 *
 * `--focus` used to carry an exemption here and no longer does. In six themes it has
 * always resolved to `surface3`; in `meadow-cream` it was the hand-tuned #E7E9D8
 * from `prototype/src/styles.css` `:root`, darker than that theme's own `surface3`, and
 * the frozen `muted` measured 4.43 on it with `subtle` at 4.40 — both short of AA, and
 * unfixable while both sides were pinned. Aligning the token to what the approved
 * reference actually renders (`--focus ← surface3`, #E9EDDF) lifted them to 4.59 and
 * 4.56, so all seven themes are now held to the same bar on all four grounds.
 *
 * 7 themes × 3 text colours × 4 grounds is 84 pairs, which is why this is a test and not
 * a review checklist.
 */

const TEXT_TOKENS = ["ink", "muted", "subtle"] as const satisfies readonly ThemeTokenName[];

/*
 * The grounds body copy is actually painted on — checked, not assumed.
 *
 * `surface3` is NOT one: it appears exactly twice in the whole product, once as the Meter
 * track's background and once in the token map. No text sits on it, and requiring the
 * third text step to clear AA there was the constraint that collapsed the default theme's
 * ramp — `muted` measures only 4.59 on `surface3`, leaving `subtle` a 0.09 band.
 *
 * `--focus` IS one, and was missing: six components paint it as a background, and
 * `FilterChipRow.module.css` puts `--muted` copy on top of it.
 */
const TEXT_GROUNDS = [
  "surface",
  "surface2",
  "shell",
  "focus",
] as const satisfies readonly ThemeTokenName[];

const AA_BODY = 4.5;

describe("text on every content ground", () => {
  it.each(THEMES)("$id keeps ink, muted and subtle at WCAG AA on every text ground", (theme) => {
    for (const token of TEXT_TOKENS) {
      for (const ground of TEXT_GROUNDS) {
        // No exemptions. `meadow-cream` carried one until `--focus` was aligned to
        // the reference's runtime value; its tightest pair is now `subtle` on `--focus`
        // at 4.56, and the rest of that theme runs 4.99–13.97.
        const ratio = contrastRatio(theme.tokens[token], theme.tokens[ground]);
        expect(
          ratio,
          `${theme.id} / ${token} on ${ground} → ${theme.tokens[token]} on ${theme.tokens[ground]}`,
        ).toBeGreaterThanOrEqual(AA_BODY);
      }
    }
  });

  it.each(THEMES)("$id keeps every text colour inside the range where AA is reachable", (theme) => {
    // 1.05 / (L + 0.05) ≥ 4.5 → L ≤ 0.1833. A text colour lighter than that cannot clear
    // AA against *any* ground, not even pure white, so no choice of surface rescues it.
    // Every ported `subtle` was above it (0.2746 … 0.3397), and so was room2-90's `muted`
    // (0.1958) — which is why the fix had to be new hex values, not a lighter surface.
    for (const token of TEXT_TOKENS) {
      expect(relativeLuminance(theme.tokens[token]), `${theme.id} / ${token}`).toBeLessThan(0.1833);
    }
  });
});

describe("the ink → muted → subtle ramp", () => {
  it.each(THEMES)("$id keeps the three text steps in order on every ground", (theme) => {
    // Ordering by contrast on a shared light ground is ordering by luminance, so this is
    // also the assertion that `subtle` stays lighter than `muted`. A derivation helper
    // (`ensureContrast(subtle, surface2, ink, 4.5)`) was tried and rejected because it
    // inverted exactly this in soft-cream-wood, spring-sage and room2-90.
    for (const ground of TEXT_GROUNDS) {
      const [ink, muted, subtle] = TEXT_TOKENS.map((token) =>
        contrastRatio(theme.tokens[token], theme.tokens[ground]),
      ) as [number, number, number];

      expect(ink, `${theme.id} / ink vs muted on ${ground}`).toBeGreaterThan(muted);
      expect(muted, `${theme.id} / muted vs subtle on ${ground}`).toBeGreaterThan(subtle);
    }
  });

  /*
   * `meadow-cream` is exempt, and the reason is a real conflict rather than a
   * tolerance: its `muted` and `subtle` are the captured reference's own values
   * (`theme-registry.test.ts` asserts the palette against `reference/default-ui.png`),
   * and they are two 8-bit steps apart to begin with — #71685F and #6F6962.
   *
   * Moving `--focus` onto the reference's runtime value lifted both sides of the pair
   * (4.43 → 4.59 for `muted`, 4.40 → 4.56 for `subtle`, so the AA exemption above could
   * go) but it could not separate them: floors of 4.586 and 4.556, a gap of 0.030 where
   * the other five run 1.38–1.43. The default theme still has two visible text weights
   * where the other five have three.
   *
   * This is recorded, not tolerated. Resolving it means moving a captured colour, and
   * that is the user's decision (CLAUDE.md §2, docs/DECISIONS.md 2026-08-09).
   */
  it.each(THEMES.filter((theme) => theme.id !== "meadow-cream"))(
    "$id keeps muted and subtle far enough apart to read as two steps",
    (theme) => {
      // Strict ordering alone would be satisfied by two hexes one 8-bit value apart, which
      // is not a ramp. These six sit at 6.02–6.05 and 4.62–4.64 on `surface3` — a gap of
      // 1.40–1.43, about 18 steps of equivalent grey.
      // Measured on the tightest ground that actually carries text, not on `surface3`,
      // which carries none. All seven now sit at 6.02–6.05 and 4.62–4.64.
      const floor = (token: "muted" | "subtle") =>
        Math.min(
          ...TEXT_GROUNDS.map((ground) => contrastRatio(theme.tokens[token], theme.tokens[ground])),
        );
      const gap = floor("muted") - floor("subtle");
      expect(gap, `${theme.id} / muted − subtle`).toBeGreaterThan(1);
    },
  );
});

describe("painted pairs the components rely on", () => {
  it.each(THEMES)("$id keeps shell readable on the forest fill", (theme) => {
    // The primary sheet button, the applied-filter pill and the rail's on-state glyph all
    // paint `color: var(--shell)` on `background: var(--forest)` (FilterSheet.module.css
    // 47–48 and 207–209, ContextualRail.module.css 119–120). Measured 5.83–8.95.
    expect(contrastRatio(theme.tokens.shell, theme.tokens.forest)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it.each(THEMES)("$id keeps ink readable on the focus tint", (theme) => {
    // `--focus` is the quiet/selected ground under SignalChip, the selected filter chip and
    // CardSurface's selected state, and the copy on it is `--ink`. Measured 10.71–11.93.
    expect(contrastRatio(theme.tokens.ink, theme.tokens.focus)).toBeGreaterThanOrEqual(AA_BODY);
  });
});
