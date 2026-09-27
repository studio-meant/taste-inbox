import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../src/theme/color";
import { THEME_DEFINITIONS } from "../src/theme/palettes";
import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  THEMES,
  THEME_IDS,
  THEME_STORAGE_KEY,
  getTheme,
  resolveTheme,
  themeCssVariables,
  themeStylesheet,
} from "../src/theme/theme-registry";
import {
  CSS_VARIABLE_BY_TOKEN,
  DOCUMENTED_CSS_VARIABLES,
  THEME_TOKEN_NAMES,
} from "../src/theme/tokens";

const HEX = /^#[0-9A-F]{6}$/;

describe("theme identity", () => {
  it("keeps the six documented themes in order", () => {
    // docs/THEME_SYSTEM.md → "Included themes". None may be deleted (CLAUDE.md §2).
    //
    // Renamed to the approved reference's own identity on 2026-08-10. Six, not seven: the
    // product's set turned out to *be* the reference's, with `room2-90` as the one addition
    // that had no counterpart there. Not a repaint — every palette colour is byte-identical
    // to what shipped under the old names.
    expect(THEMES.map((theme) => theme.id)).toEqual([
      "meadow-cream",
      "moss-cream",
      "spring-sage",
      "bright-forest",
      "ivory-sage",
      "oatwood-cream",
    ]);
    expect(THEME_IDS).toEqual(THEMES.map((theme) => theme.id));
  });

  it("defaults to Meadow Cream", () => {
    // Locked decision: DECISIONS.md → Default theme, CLAUDE.md §2 and §6.
    expect(DEFAULT_THEME_ID).toBe("meadow-cream");
    expect(DEFAULT_THEME.id).toBe("meadow-cream");
    expect(DEFAULT_THEME.name).toBe("Meadow Cream");
  });

  it("marks exactly one theme as recommended, and it is the default", () => {
    const recommended = THEMES.filter((theme) => theme.recommended === true);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]?.id).toBe(DEFAULT_THEME_ID);
  });

  it("uses the versioned storage key", () => {
    // docs/THEME_SYSTEM.md: the v3 key prevents an older prototype's saved theme from
    // overriding the revised default on first launch.
    expect(THEME_STORAGE_KEY).toBe("taste-inbox-component-theme-v4");
  });

  it("falls back to the default for an unknown or missing id", () => {
    expect(resolveTheme("no-such-theme").id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme("no-such-theme")).toBeUndefined();
  });
});

describe("token completeness", () => {
  it.each(THEMES)("$id defines every token", (theme) => {
    for (const token of THEME_TOKEN_NAMES) {
      expect(theme.tokens[token], token).toBeTruthy();
    }
    expect(Object.keys(theme.tokens).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
  });

  it("publishes all 21 CSS custom properties named in THEME_SYSTEM.md", () => {
    const emitted = new Set(Object.values(CSS_VARIABLE_BY_TOKEN));
    for (const variable of DOCUMENTED_CSS_VARIABLES) {
      expect(emitted.has(variable), variable).toBe(true);
    }
  });

  it.each(THEMES)("$id emits one declaration per token", (theme) => {
    const declarations = themeCssVariables(theme);
    expect(Object.keys(declarations)).toHaveLength(THEME_TOKEN_NAMES.length);
    for (const variable of DOCUMENTED_CSS_VARIABLES) {
      expect(declarations[variable], variable).toBeTruthy();
    }
  });

  it.each(THEMES)("$id has six preview swatches", (theme) => {
    expect(theme.swatches).toHaveLength(6);
    for (const swatch of theme.swatches) {
      expect(swatch).toMatch(HEX);
    }
  });

  it.each(THEMES)("$id is frozen", (theme) => {
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.tokens)).toBe(true);
  });
});

describe("ramp integrity", () => {
  /**
   * The prototype collapsed `--sage` onto `--accent`, `--light-wood` onto `--wood`,
   * `--cream` onto `--outer` and `--leaf` onto a mid hill, so the documented
   * "light green → sage → leaf → forest" ramp was unreachable at runtime. These
   * assertions exist so that regression cannot come back.
   */
  it.each(THEMES)("$id keeps the green ramp monotonically darker", (theme) => {
    const ramp = [
      theme.tokens.lightGreen,
      theme.tokens.sage,
      theme.tokens.leaf,
      theme.tokens.forest,
    ];
    const luminances = ramp.map(relativeLuminance);

    for (let index = 1; index < luminances.length; index += 1) {
      expect(
        luminances[index]! < luminances[index - 1]!,
        `${ramp[index - 1]!} → ${ramp[index]!}`,
      ).toBe(true);
    }
  });

  it.each(THEMES)("$id keeps the warm ramp monotonically darker", (theme) => {
    const ramp = [theme.tokens.cream, theme.tokens.oatmeal, theme.tokens.lightWood];
    const luminances = ramp.map(relativeLuminance);

    for (let index = 1; index < luminances.length; index += 1) {
      expect(
        luminances[index]! < luminances[index - 1]!,
        `${ramp[index - 1]!} → ${ramp[index]!}`,
      ).toBe(true);
    }
  });

  it.each(THEMES)("$id does not alias ramp steps onto their base colours", (theme) => {
    expect(theme.tokens.lightWood).not.toBe(theme.tokens.wood);
    expect(theme.tokens.leaf).not.toBe(theme.tokens.sage);
    expect(theme.tokens.lightGreen).not.toBe(theme.tokens.sage);
    expect(theme.tokens.orchid).not.toBe(theme.tokens.danger);
  });

  /**
   * The six steps where the reference's runtime rule *is* adopted, checked on every
   * theme rather than only on the default. This is what stops the alignment from being
   * a table of hexes that happens to match one screenshot: the rule is the artefact.
   *
   * Source: `App.prototype.applyTheme` in `reference/ref.js`, identical in
   * `prototype/src/app.js`.
   */
  it.each(THEMES)("$id binds the six adopted steps to the reference's own sources", (theme) => {
    const palette = THEME_DEFINITIONS.find((definition) => definition.id === theme.id)?.palette;
    expect(palette).toBeDefined();
    expect(theme.tokens.lightGreen, "--light-green ← skyMid").toBe(palette?.skyMid);
    expect(theme.tokens.forest, "--forest ← accentDeep").toBe(palette?.accentDeep);
    expect(theme.tokens.cream, "--cream ← canvas").toBe(palette?.canvas);
    expect(theme.tokens.oatmeal, "--oatmeal ← canvasDeep").toBe(palette?.canvasDeep);
    expect(theme.tokens.focus, "--focus ← surface3").toBe(palette?.surface3);
    // `--sage ← accent` in the reference; `hill2` here, because it is the ramp's own
    // scenic source and the two agree on the default theme (#A8B991).
    expect(theme.tokens.sage, "--sage ← hill2").toBe(palette?.hill2);
  });

  it.each(THEMES)("$id keeps the leaf step between sage and forest", (theme) => {
    // The reference collapses `--leaf` onto `--sage`; the ramp keeps it a real step.
    const [sage, leaf, forest] = [theme.tokens.sage, theme.tokens.leaf, theme.tokens.forest].map(
      relativeLuminance,
    ) as [number, number, number];
    expect(leaf, `${theme.id}: leaf under sage`).toBeLessThan(sage);
    expect(leaf, `${theme.id}: leaf over forest`).toBeGreaterThan(forest);
  });
});

describe("shadow ink", () => {
  /**
   * `--shadow-color` is the only input `src/styles/tokens.css` has for `--shadow-shell`,
   * `--shadow-card` and `--shadow-float`, so a cool value here tints every elevated
   * surface in the product. The reference never rebinds it — `applyTheme` sets 29
   * properties and this is not one of them — so its shadows are the same warm brown on
   * all seven themes. The ported values were each theme's own dark green.
   */
  it.each(THEMES)("$id casts the reference's warm shadow", (theme) => {
    expect(theme.tokens.shadowColor).toBe("rgba(55,43,34,.16)");
  });
});

describe("default theme fidelity", () => {
  /**
   * These are the values the approved reference actually renders, not the ones its
   * stylesheet declares.
   *
   * The earlier expectations here were read out of `prototype/src/styles.css` `:root`.
   * That was the wrong source: `prototype/src/app.js` and
   * `reference/taste-inbox-ui-ux-final.html` both rebind the ramp on every theme change
   * (`['--light-green', c.skyMid], ['--sage', c.accent], ['--leaf', c.hill2],
   * ['--orchid', c.danger], ['--focus', c.surface3]`, …), so the `:root` block never
   * survives first paint and `reference/default-ui.png` was captured with the runtime
   * values below. Six of the nine steps are now pinned to that capture exactly.
   *
   * `leaf`, `lightWood` and `orchid` are pinned to the derived tint instead, and the
   * assertion right below this one is why: the reference's runtime rule sets each of
   * them to a colour another token already holds (`hill2` = `sage`, `wood`, `danger`),
   * which is the collapse docs/THEME_SYSTEM.md's two ramps exist to prevent.
   */
  it("matches the captured reference palette", () => {
    expect(DEFAULT_THEME.tokens).toMatchObject({
      outer: "#F4EFE5",
      outerDeep: "#E2D7C7",
      shell: "#FAF5EB",
      surface: "#FFFDF8",
      surface2: "#FCF8EF",
      ink: "#2F2A25",
      muted: "#71685F",
      accent: "#A8B991",
      accentDeep: "#50654E",
      sun: "#D2BF86",
      wood: "#B97E5D",
      inverse: "#51483D",
      // Reference runtime, adopted verbatim.
      lightGreen: "#DFE7CC", // ← skyMid
      sage: "#A8B991", // ← accent, and this theme's hill2 is the same colour
      forest: "#50654E", // ← accentDeep
      cream: "#F4EFE5", // ← canvas
      oatmeal: "#E2D7C7", // ← canvasDeep
      focus: "#E9EDDF", // ← surface3
      // Reference runtime collapses these onto sage / wood / danger; kept as steps.
      leaf: "#879C78", // reference renders #A8B991, i.e. sage
      lightWood: "#B89F83", // reference renders #B97E5D, i.e. wood
      orchid: "#BD8768", // reference renders #B97E5D, i.e. danger
    });
  });

  it("keeps the three refused steps clear of the colours they would collapse onto", () => {
    // The counterpart to the expectations above: each of these is allowed to sit near
    // the reference's value, but never to become the token it is a step away from.
    expect(DEFAULT_THEME.tokens.leaf).not.toBe(DEFAULT_THEME.tokens.sage);
    expect(DEFAULT_THEME.tokens.lightWood).not.toBe(DEFAULT_THEME.tokens.wood);
    expect(DEFAULT_THEME.tokens.orchid).not.toBe(DEFAULT_THEME.tokens.danger);
  });

  it("is the only theme that overrides the derivation rule", () => {
    const overriding = THEME_DEFINITIONS.filter((definition) => definition.ramp !== undefined);
    expect(overriding.map((definition) => definition.id)).toEqual([DEFAULT_THEME_ID]);
  });

  it("needs that override for one step only", () => {
    // Every other step now falls out of `deriveRamp`, so the default theme is held to
    // the same rule as the other six instead of being a table of literals.
    const override = THEME_DEFINITIONS.find(
      (definition) => definition.id === DEFAULT_THEME_ID,
    )?.ramp;
    expect(Object.keys(override ?? {})).toEqual(["lightWood"]);
  });
});

describe("readability", () => {
  it.each(THEMES)("$id keeps body text readable on every content surface", (theme) => {
    // DESIGN.md §18 / architecture §23 — WCAG AA for body copy.
    for (const surface of [theme.tokens.surface, theme.tokens.surface2, theme.tokens.shell]) {
      expect(contrastRatio(theme.tokens.ink, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)("$id keeps secondary text at large-text contrast", (theme) => {
    expect(contrastRatio(theme.tokens.muted, theme.tokens.surface)).toBeGreaterThanOrEqual(3);
  });
});

describe("stylesheet emission", () => {
  const css = themeStylesheet();

  it("emits a root block plus one block per theme", () => {
    expect(css).toContain(":root {");
    for (const theme of THEMES) {
      expect(css).toContain(`[data-theme="${theme.id}"] {`);
    }
  });

  it("declares every documented property in the root block", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    for (const variable of DOCUMENTED_CSS_VARIABLES) {
      expect(root, variable).toContain(`${variable}: `);
    }
  });

  it("carries no colour literal that is not a token value", () => {
    const known = new Set(THEMES.flatMap((theme) => Object.values(theme.tokens)));
    for (const literal of css.match(/#[0-9A-Fa-f]{6}/g) ?? []) {
      expect(known.has(literal.toUpperCase()) || known.has(literal), literal).toBe(true);
    }
  });
});

describe("structural token stylesheet", () => {
  const read = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), "utf8");

  it("keeps colour out of the structural tokens", () => {
    // DESIGN.md §20: colour belongs to the theme registry, never to a static file.
    expect(read("tokens.css")).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it("matches the machine-readable motion spec", () => {
    const spec = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../../docs/MOTION_SPEC.json", import.meta.url)),
        "utf8",
      ),
    ) as {
      defaultTheme: string;
      scene: { forwardMs: number; backMs: number; reducedMs: number; easing: string };
      stagger: { baseDelayMs: number; cardStepMs: number; queueRowStepMs: number };
      sharedElements: { durationMs: number }[];
    };
    const css = read("motion.css");

    expect(spec.defaultTheme).toBe(DEFAULT_THEME_ID);
    expect(css).toContain(`--duration-scene-forward: ${String(spec.scene.forwardMs)}ms;`);
    expect(css).toContain(`--duration-scene-back: ${String(spec.scene.backMs)}ms;`);
    expect(css).toContain(`--duration-scene-reduced: ${String(spec.scene.reducedMs)}ms;`);
    expect(css).toContain(`--delay-heading: ${String(spec.stagger.baseDelayMs)}ms;`);
    expect(css).toContain(`--stagger-card: ${String(spec.stagger.cardStepMs)}ms;`);
    expect(css).toContain(`--stagger-queue-row: ${String(spec.stagger.queueRowStepMs)}ms;`);
    expect(css).toContain(
      `--duration-shared-element: ${String(spec.sharedElements[0]?.durationMs)}ms;`,
    );
    expect(css).toContain("cubic-bezier(0.22, 0.72, 0.18, 1)");
  });

  it("honours both reduced-motion triggers", () => {
    // The OS preference and the product's own Cinematic/Reduced switch.
    const css = read("motion.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(':root[data-motion="reduced"]');
  });
});
