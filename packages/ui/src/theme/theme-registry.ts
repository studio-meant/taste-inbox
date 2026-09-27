import themeIdentity from "../../theme-ids.json" with { type: "json" };
import { ensureContrast, mix } from "./color";
import {
  THEME_DEFINITIONS,
  type DerivedTokenName,
  type ThemeDefinition,
  type ThemePalette,
} from "./palettes";
import {
  CSS_VARIABLE_BY_TOKEN,
  THEME_TOKEN_NAMES,
  type StatusTokenName,
  type ThemeTokenName,
  type ThemeTokens,
} from "./tokens";

/**
 * Resolved theme registry.
 *
 * Source of truth: docs/THEME_SYSTEM.md. All seven themes stay selectable and the
 * default stays `meadow-cream` (CLAUDE.md §2, DECISIONS.md).
 */

export const DEFAULT_THEME_ID = themeIdentity.defaultThemeId;

/**
 * Deliberately versioned. docs/THEME_SYSTEM.md: the `v3` key exists so an older
 * prototype's saved theme cannot override the revised default on first launch.
 */
export const THEME_STORAGE_KEY = themeIdentity.storageKey;

export const THEME_IDS: readonly string[] = themeIdentity.themeIds;

export interface Theme extends Omit<ThemeDefinition, "palette" | "ramp"> {
  readonly tokens: ThemeTokens;
}

/**
 * Ramp derivation.
 *
 * The approved reference (`reference/taste-inbox-ui-ux-final.html`) does not read the
 * ramp out of its own `:root`; `applyTheme` rebinds 29 custom properties on every theme
 * change, so what a screenshot of it actually shows is
 *
 * ```text
 * --light-green ← skyMid    --sage  ← accent   --leaf   ← hill2
 * --forest      ← accentDeep --cream ← canvas  --oatmeal ← canvasDeep
 * --light-wood  ← wood      --orchid ← danger  --focus  ← surface3
 * ```
 *
 * (`reference/ref.js` `App.prototype.applyTheme`; `prototype/src/app.js` is identical,
 * which means `reference/default-ui.png` was captured with these values too, not with
 * the `:root` block above them.)
 *
 * Six of the nine are adopted verbatim below. Three are not, and the reason is the same
 * one in all three cases: the reference's rule *collapses a token onto the colour it is
 * supposed to be a step away from*, which is exactly what docs/THEME_SYSTEM.md's
 * "Light green → sage → leaf → forest" and "Cream → oatmeal → light wood" structure
 * forbids, and what `theme-registry.test.ts` → "ramp integrity" pins.
 *
 * - `leaf ← hill2` makes `--leaf` identical to `--sage` (both #A8B991 on the default),
 *   so the four-step green ramp becomes three. `leaf` is instead the midpoint of the two
 *   hills the ramp already walks, which keeps it strictly between sage and forest while
 *   moving it a long way toward the reference (#718967 → #879C78, against #A8B991).
 * - `light-wood ← wood` makes `--light-wood` identical to `--wood`, so it stays a tint.
 * - `orchid ← danger` makes the warm glow tint identical to the raw signal hue. It is
 *   instead that hue carried one tenth toward the oatmeal canvas it glows over, which
 *   lands within a few 8-bit steps of the reference (#BD8768 against #B97E5D) while
 *   staying a derived tint rather than an alias.
 *
 * A theme may override any of these; only the default does, and only for `light-wood`.
 */
function deriveRamp(palette: ThemePalette): Record<DerivedTokenName, string> {
  return {
    lightGreen: palette.skyMid,
    sage: palette.hill2,
    leaf: mix(palette.hill2, palette.hill3, 0.5),
    forest: palette.accentDeep,
    cream: palette.canvas,
    oatmeal: palette.canvasDeep,
    lightWood: mix(palette.wood, palette.canvasDeep, 0.7),
    orchid: mix(palette.danger, palette.canvasDeep, 0.9),
    focus: palette.surface3,
  };
}

/**
 * Semantic status pairs.
 *
 * DESIGN.md §7 defines these against the specification's own lavender baseline. The
 * seven shipped palettes are green and cream, so the literal values there cannot be
 * reused; what carries over is the *meaning* and the contrast obligation.
 *
 * Each background is a light tint of a colour the theme already owns, and each
 * foreground is that same colour walked toward the theme's ink until it clears WCAG AA
 * against its own background. Derivation rather than hand-picking is what makes
 * "readable in all seven themes" a property the tests can prove.
 */
function deriveStatusTokens(
  palette: ThemePalette,
  ramp: Record<DerivedTokenName, string>,
): Record<StatusTokenName, string> {
  const surface = palette.surface;
  const ink = palette.text;

  const pair = (hue: string, tintWeight: number): { bg: string; fg: string } => {
    const bg = mix(hue, surface, tintWeight);
    return { bg, fg: ensureContrast(hue, bg, ink) };
  };

  // ready → the theme's deepest green; the product's "환경이 준비됨" meaning.
  const ready = pair(ramp.forest, 0.16);
  // info → the leaf step, a quieter neighbour of ready, so the two never read as equal.
  const info = pair(ramp.leaf, 0.14);
  // warning → the theme's own warning hue (sun / oat family).
  const warning = pair(palette.warning, 0.34);
  // danger → the theme's own danger hue (terracotta / wood family).
  const danger = pair(palette.danger, 0.24);
  // neutral → no hue at all, so "nothing to report" never looks like a state.
  const neutral = {
    bg: palette.surface2,
    fg: ensureContrast(palette.muted, palette.surface2, ink),
  };

  return {
    statusReadyBg: ready.bg,
    statusReadyFg: ready.fg,
    statusInfoBg: info.bg,
    statusInfoFg: info.fg,
    statusWarningBg: warning.bg,
    statusWarningFg: warning.fg,
    statusDangerBg: danger.bg,
    statusDangerFg: danger.fg,
    statusNeutralBg: neutral.bg,
    statusNeutralFg: neutral.fg,
  };
}

function resolveTokens(definition: ThemeDefinition): ThemeTokens {
  const { palette } = definition;
  const ramp = { ...deriveRamp(palette), ...definition.ramp };
  const status = deriveStatusTokens(palette, ramp);

  const tokens: Record<ThemeTokenName, string> = {
    outer: palette.canvas,
    outerDeep: palette.canvasDeep,
    shell: palette.shell,
    surface: palette.surface,
    surface2: palette.surface2,
    surface3: palette.surface3,
    ink: palette.text,
    muted: palette.muted,
    subtle: palette.subtle,
    inverse: palette.inverse,
    accent: palette.accent,
    accentDeep: palette.accentDeep,
    sun: palette.accent2,
    wood: palette.wood,
    lightGreen: ramp.lightGreen,
    sage: ramp.sage,
    leaf: ramp.leaf,
    forest: ramp.forest,
    cream: ramp.cream,
    oatmeal: ramp.oatmeal,
    lightWood: ramp.lightWood,
    orchid: ramp.orchid,
    focus: ramp.focus,
    // DESIGN.md §13 mandates `outline: 2px solid var(--focus-ring)`. The ring must be
    // perceivable on both grounds the product actually uses, so it is derived twice
    // and held to the 3:1 non-text contrast minimum (DESIGN.md §18).
    focusRing: ensureContrast(palette.accentDeep, palette.surface, palette.text, 3),
    focusRingContrast: ensureContrast(palette.surface, palette.inverse, "#FFFFFF", 3),
    border: palette.border,
    glass: palette.glass,
    glassStrong: palette.glassStrong,
    shadowColor: palette.shadow,
    skyTop: palette.skyTop,
    skyMid: palette.skyMid,
    skyBottom: palette.skyBottom,
    hill1: palette.hill1,
    hill2: palette.hill2,
    hill3: palette.hill3,
    water: palette.water,
    scenicLine: palette.line,
    warning: palette.warning,
    danger: palette.danger,
    ...status,
  };

  return Object.freeze(tokens);
}

export const THEMES: readonly Theme[] = THEME_DEFINITIONS.map((definition) => {
  const { palette: _palette, ramp: _ramp, ...meta } = definition;
  return Object.freeze({ ...meta, tokens: resolveTokens(definition) });
});

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function getTheme(id: string): Theme | undefined {
  return THEME_BY_ID.get(id);
}

/** Resolve a persisted or user-supplied id, falling back to the product default. */
export function resolveTheme(id: string | null | undefined): Theme {
  const requested = id === null || id === undefined ? undefined : THEME_BY_ID.get(id);
  if (requested !== undefined) {
    return requested;
  }
  const fallback = THEME_BY_ID.get(DEFAULT_THEME_ID);
  if (fallback === undefined) {
    throw new Error(`Default theme "${DEFAULT_THEME_ID}" is missing from the registry`);
  }
  return fallback;
}

export const DEFAULT_THEME: Theme = resolveTheme(DEFAULT_THEME_ID);

/** `{ "--outer": "#F4EFE5", ... }` — ready to spread onto a style attribute. */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const token of THEME_TOKEN_NAMES) {
    declarations[CSS_VARIABLE_BY_TOKEN[token]] = theme.tokens[token];
  }
  return declarations;
}

/**
 * Emit every theme as a `[data-theme="..."]` block.
 *
 * Themes are applied by swapping one attribute on the root element, so a theme change
 * updates tokens in place and preserves the current screen, filters and Query Dock
 * state (docs/THEME_SYSTEM.md, CLAUDE.md §6).
 */
export function themeStylesheet(themes: readonly Theme[] = THEMES): string {
  const block = (selector: string, theme: Theme): string => {
    const body = THEME_TOKEN_NAMES.map(
      (token) => `  ${CSS_VARIABLE_BY_TOKEN[token]}: ${theme.tokens[token]};`,
    ).join("\n");
    return `${selector} {\n${body}\n}`;
  };

  const blocks = [
    "/* Generated from packages/ui/src/theme. Do not edit by hand. */",
    block(":root", DEFAULT_THEME),
    ...themes.map((theme) => block(`[data-theme="${theme.id}"]`, theme)),
  ];
  return `${blocks.join("\n\n")}\n`;
}
