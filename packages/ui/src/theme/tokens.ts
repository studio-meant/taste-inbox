/**
 * Theme token vocabulary.
 *
 * Source of truth: docs/THEME_SYSTEM.md ("Runtime binding") for the 21 documented
 * custom properties, plus the scenic and utility tokens the prototype's
 * `ScenicBackdrop` actually needs.
 *
 * Every theme must supply a value for every token. The prototype derived several
 * tokens at runtime and collapsed them onto each other — `--sage` onto `--accent`,
 * `--light-wood` onto `--wood`, `--leaf` onto a mid hill — which made the documented
 * "light green → sage → leaf → forest" ramp unreachable. Nothing is derived at runtime
 * here; the ramp is resolved once, at build time, and asserted by tests.
 */

/** The 21 properties named in docs/THEME_SYSTEM.md. Removing one is a doc change. */
export const DOCUMENTED_CSS_VARIABLES = [
  "--outer",
  "--outer-deep",
  "--shell",
  "--surface",
  "--surface-2",
  "--ink",
  "--muted",
  "--accent",
  "--accent-deep",
  "--sun",
  "--wood",
  "--inverse",
  "--light-green",
  "--sage",
  "--leaf",
  "--forest",
  "--cream",
  "--oatmeal",
  "--light-wood",
  "--orchid",
  "--focus",
] as const;

export const THEME_TOKEN_NAMES = [
  // Frame and surfaces
  "outer",
  "outerDeep",
  "shell",
  "surface",
  "surface2",
  "surface3",
  // Text
  "ink",
  "muted",
  "subtle",
  "inverse",
  // Accents
  "accent",
  "accentDeep",
  "sun",
  "wood",
  // Green ramp: light green → sage → leaf → forest
  "lightGreen",
  "sage",
  "leaf",
  "forest",
  // Warm ramp: cream → oatmeal → light wood
  "cream",
  "oatmeal",
  "lightWood",
  // Tints
  "orchid",
  /** A pale surface tint used for selected/quiet grounds. NOT the focus ring. */
  "focus",
  // Focus ring (DESIGN.md §13 "Focus"). Two grounds, because one colour cannot clear
  // 3:1 against both a near-white surface and the dark `inverse` capsule.
  "focusRing",
  "focusRingContrast",
  // Lines, glass and shadow
  "border",
  "glass",
  "glassStrong",
  "shadowColor",
  // Scenic backdrop
  "skyTop",
  "skyMid",
  "skyBottom",
  "hill1",
  "hill2",
  "hill3",
  "water",
  "scenicLine",
  // Raw signal hues. Never used for status directly — DESIGN.md §7 "Rules":
  // status uses the semantic palette, not the signal palette.
  "warning",
  "danger",
  // Semantic status pairs (DESIGN.md §7 "Semantic status"). Foreground/background are
  // always used together and are guaranteed to clear WCAG AA in every theme.
  "statusReadyBg",
  "statusReadyFg",
  "statusInfoBg",
  "statusInfoFg",
  "statusWarningBg",
  "statusWarningFg",
  "statusDangerBg",
  "statusDangerFg",
  "statusNeutralBg",
  "statusNeutralFg",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;

/** Token → CSS custom property. The documented 21 keep their published names. */
export const CSS_VARIABLE_BY_TOKEN: Readonly<Record<ThemeTokenName, string>> = {
  outer: "--outer",
  outerDeep: "--outer-deep",
  shell: "--shell",
  surface: "--surface",
  surface2: "--surface-2",
  surface3: "--surface-3",
  ink: "--ink",
  muted: "--muted",
  subtle: "--subtle",
  inverse: "--inverse",
  accent: "--accent",
  accentDeep: "--accent-deep",
  sun: "--sun",
  wood: "--wood",
  lightGreen: "--light-green",
  sage: "--sage",
  leaf: "--leaf",
  forest: "--forest",
  cream: "--cream",
  oatmeal: "--oatmeal",
  lightWood: "--light-wood",
  orchid: "--orchid",
  focus: "--focus",
  focusRing: "--focus-ring",
  focusRingContrast: "--focus-ring-contrast",
  border: "--border",
  glass: "--glass",
  glassStrong: "--glass-strong",
  shadowColor: "--shadow-color",
  skyTop: "--sky-top",
  skyMid: "--sky-mid",
  skyBottom: "--sky-bottom",
  hill1: "--hill-1",
  hill2: "--hill-2",
  hill3: "--hill-3",
  water: "--water",
  scenicLine: "--scenic-line",
  warning: "--warning",
  danger: "--danger",
  statusReadyBg: "--status-ready-bg",
  statusReadyFg: "--status-ready-fg",
  statusInfoBg: "--status-info-bg",
  statusInfoFg: "--status-info-fg",
  statusWarningBg: "--status-warning-bg",
  statusWarningFg: "--status-warning-fg",
  statusDangerBg: "--status-danger-bg",
  statusDangerFg: "--status-danger-fg",
  statusNeutralBg: "--status-neutral-bg",
  statusNeutralFg: "--status-neutral-fg",
};

/**
 * The semantic status vocabulary, in the order the UI should prefer it.
 * `StatusPill` maps a domain status onto one of these; primitives never learn the
 * domain vocabulary itself (frontend architecture §6.1).
 */
export const STATUS_TONES = ["ready", "info", "warning", "danger", "neutral"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

/** Exactly the ten semantic status tokens, narrowed from the full token union. */
export type StatusTokenName = Extract<ThemeTokenName, `status${string}`>;

export const STATUS_TOKENS: Readonly<
  Record<StatusTone, { readonly bg: ThemeTokenName; readonly fg: ThemeTokenName }>
> = {
  ready: { bg: "statusReadyBg", fg: "statusReadyFg" },
  info: { bg: "statusInfoBg", fg: "statusInfoFg" },
  warning: { bg: "statusWarningBg", fg: "statusWarningFg" },
  danger: { bg: "statusDangerBg", fg: "statusDangerFg" },
  neutral: { bg: "statusNeutralBg", fg: "statusNeutralFg" },
};

/**
 * The family a theme belongs to, as the approved reference names them.
 *
 * Reference vocabulary, not ours: these strings are rendered beside a theme's name in the
 * picker, so they have to be the words the design uses for its own palettes rather than a
 * parallel taxonomy invented here.
 */
export type ThemeGroup =
  "Balanced green" | "Deep green" | "Light green" | "Green-led" | "Neutral sage" | "Warm neutral";
