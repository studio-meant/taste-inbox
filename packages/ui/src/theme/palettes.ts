import type { ThemeGroup, ThemeTokenName } from "./tokens";

/**
 * The seven explored palettes.
 *
 * Colour values are ported verbatim from `prototype/src/themeRegistry.js`, which is the
 * visual source of truth (CLAUDE.md §3). Korean copy is preserved as written.
 * None of the seven may be deleted (CLAUDE.md §2).
 */

/** Base palette, one entry per colour the prototype registry defines. */
export interface ThemePalette {
  readonly canvas: string;
  readonly canvasDeep: string;
  readonly shell: string;
  readonly surface: string;
  readonly surface2: string;
  readonly surface3: string;
  readonly text: string;
  /**
   * Secondary and tertiary text.
   *
   * Both carry real body copy at 11–13px — `--subtle` alone paints ~31 call sites,
   * including the empty-state description and the Music card's raw observed string —
   * so both owe WCAG AA (4.5:1, DESIGN.md §18) on every ground the product paints text
   * on: `surface`, `surface2`, `surface3` and `shell`. The values ported from the
   * prototype did not pay it. Measured with `contrastRatio` against the resolved
   * registry, `subtle` ran 2.20–3.20 across the seven themes — below even the 3:1
   * non-text floor — and `muted` fell to 3.49 on room2-90's `surface3`.
   *
   * Raising `subtle` alone is impossible: no colour lighter than 0.1833 relative
   * luminance reaches 4.5:1 against *any* ground (1.05 / 0.2333 = 4.50 against pure
   * white), and every shipped `muted` sat at 0.1424–0.1958. `subtle` has to stay lighter
   * than `muted` for the ink → muted → subtle ramp to mean anything, so `muted` had to
   * move first and make room.
   *
   * The corrected hexes are the original ones scaled in linear RGB, which holds
   * chromaticity — hue and purity — fixed up to 8-bit rounding and moves only luminance,
   * so each theme still reads as itself. Targets, taken on each theme's deepest content
   * ground (`surface3` in all seven): `muted` ≈ 6:1 and `subtle` ≈ 4.6:1, under ink's
   * 10.7–11.9:1. The one `muted` that could not move is noted at its own palette.
   * `tests/text-contrast.test.ts` pins both the floor and the order.
   */
  readonly muted: string;
  readonly subtle: string;
  readonly accent: string;
  readonly accent2: string;
  readonly accentDeep: string;
  readonly wood: string;
  readonly inverse: string;
  readonly border: string;
  readonly glass: string;
  readonly glassStrong: string;
  readonly skyTop: string;
  readonly skyMid: string;
  readonly skyBottom: string;
  readonly hill1: string;
  readonly hill2: string;
  readonly hill3: string;
  readonly water: string;
  readonly line: string;
  /**
   * Shadow ink — the only input to all three shadow tokens.
   *
   * `--shadow-color` has exactly one consumer: `src/styles/tokens.css`, which composes
   * `--shadow-shell`, `--shadow-card` and `--shadow-float` from it. So this value alone
   * decides whether every elevated surface in the product casts a warm or a cool shadow.
   *
   * The approved reference casts a warm one, on every theme. Its `applyTheme` rebinds 29
   * custom properties and `--shadow-color` is not among them, so its shadows never change
   * with the theme: `rgba(55, 43, 34, .16)` for the shell and the float layer, and
   * rgba(45,38,32,.025) + rgba(73,58,45,.065) for the card. The ported values were the
   * theme's own dark green instead — rgba(58,69,51,.16) on the default — which is what
   * made ours read cool against the same cream canvas.
   *
   * Held uniform for that reason, not ported per theme. Geometry (offset, blur, and the
   * reference's second shell layer) is structural and lives in `tokens.css`.
   */
  readonly shadow: string;
  readonly warning: string;
  readonly danger: string;
}

/** Tokens that are derived from the palette unless a theme states otherwise. */
export type DerivedTokenName = Extract<
  ThemeTokenName,
  "lightGreen" | "sage" | "leaf" | "forest" | "cream" | "oatmeal" | "lightWood" | "orchid" | "focus"
>;

export type ThemeRampOverride = Partial<Readonly<Record<DerivedTokenName, string>>>;

export interface ThemeDefinition {
  readonly id: string;
  readonly name: string;
  readonly short: string;
  readonly group: ThemeGroup;
  readonly description: string;
  readonly note: string;
  /** Exactly one theme carries this; it is the product default. */
  readonly recommended?: boolean;
  /** Six-swatch preview shown in the Theme Library. */
  readonly swatches: readonly [string, string, string, string, string, string];
  readonly palette: ThemePalette;
  /**
   * Hand-tuned ramp values. Only the default theme sets these, and now only for the one
   * step where the reference's own runtime rule would collapse a ramp: its exact
   * appearance is fixed by `reference/taste-inbox-ui-ux-final.html` and
   * `reference/default-ui.png`, so it is not allowed to drift with the derivation rule.
   * Every other theme uses the rule for every step.
   */
  readonly ramp?: ThemeRampOverride;
}

export const THEME_DEFINITIONS: readonly ThemeDefinition[] = [
  {
    id: "meadow-cream",
    name: "Meadow Cream",
    short: "Meadow Cream",
    group: "Balanced green",
    description:
      "연두·세이지·크림·오트밀·라이트 우드를 가장 고르게 섞은 기본 테마. Moss Cream보다 대비가 부드럽고 라이트 우드의 온기가 더 잘 드러납니다.",
    note: "가장 안정적인 균형 · 기본 테마",
    recommended: true,
    swatches: ["#F4EFE5", "#FFFDF8", "#A8B991", "#D2BF86", "#B97E5D", "#50654E"],
    palette: {
      canvas: "#F4EFE5",
      canvasDeep: "#E2D7C7",
      shell: "#FAF5EB",
      surface: "#FFFDF8",
      surface2: "#FCF8EF",
      surface3: "#E9EDDF",
      text: "#2F2A25",
      muted: "#71685F",
      /*
       * The one theme whose `muted` is pinned: it comes from `prototype/src/styles.css`,
       * which is what `reference/default-ui.png` was captured with, and
       * `theme-registry.test.ts` asserts the whole palette against that capture.
       *
       * Re-measured after `--focus` moved to the reference's runtime value (#E9EDDF, this
       * theme's own `surface3`, up from the `:root` block's darker #E7E9D8): `muted` now
       * runs 5.37 / 5.15 / 5.02 / 4.59 and this `subtle` 5.33 / 5.11 / 4.99 / 4.56 on
       * `surface` / `surface2` / `shell` / `focus`. Both clear AA on all four grounds now,
       * so `text-contrast.test.ts` no longer exempts this theme's `--focus`.
       *
       * What the move did not fix is the *gap*: 0.03 between the two floors, one 8-bit
       * step, so this theme still reads as two text weights where the other six read as
       * three. Widening it means moving a captured colour, which is the user's call, not
       * this file's (CLAUDE.md §2).
       */
      subtle: "#6F6962",
      accent: "#A8B991",
      accent2: "#D2BF86",
      accentDeep: "#50654E",
      wood: "#B97E5D",
      inverse: "#51483D",
      border: "rgba(80,101,78,.14)",
      glass: "rgba(255,253,248,.77)",
      glassStrong: "rgba(255,253,248,.95)",
      skyTop: "#F7F2E9",
      skyMid: "#DFE7CC",
      skyBottom: "#B9C99F",
      hill1: "#D6E1BE",
      hill2: "#A8B991",
      hill3: "#667E5F",
      water: "#E8DFCF",
      line: "rgba(255,253,248,.50)",
      shadow: "rgba(55,43,34,.16)",
      warning: "#D2BF86",
      danger: "#B97E5D",
    },
    /**
     * One hand-tuned step, down from nine.
     *
     * The eight that were removed came from `prototype/src/styles.css` `:root`, on the
     * belief that `:root` is what `reference/default-ui.png` shows. It is not: both
     * `prototype/src/app.js` and the approved `reference/taste-inbox-ui-ux-final.html`
     * rebind those properties at runtime, so the captured screenshot renders
     * `skyMid / hill2 / accentDeep / canvas / canvasDeep / surface3` — which is what
     * `deriveRamp` now produces for this theme without an override at all.
     *
     * `light-wood` stays, because the reference's runtime rule for it is
     * `--light-wood ← wood`, which collapses the warm ramp's third step onto its second
     * (CLAUDE.md §3 puts docs/THEME_SYSTEM.md above the prototype). #B89F83 is the tint
     * the design file actually specifies; the generic `mix(wood, canvasDeep, .7)` gives
     * #C5997D here, which is lighter and pinker than the captured surface.
     */
    ramp: {
      lightWood: "#B89F83",
    },
  },
  {
    id: "moss-cream",
    name: "Moss Cream",
    short: "Moss Cream",
    group: "Deep green",
    description:
      "Meadow Cream과 유사한 크림·세이지 기반이지만 모스·포레스트 그린의 대비를 더 높인 테마. 필터 레일과 액션 패널이 더 선명합니다.",
    note: "Meadow Cream보다 그린 대비가 깊고 구조적.",
    swatches: ["#F7F2E8", "#FFFDF8", "#B3AE99", "#D5C39B", "#B98B70", "#405234"],
    palette: {
      canvas: "#F7F2E8",
      canvasDeep: "#E5D8C6",
      shell: "#FBF7EF",
      surface: "#FFFDF8",
      surface2: "#F6EFE3",
      surface3: "#E8EBDC",
      text: "#322F29",
      muted: "#5D554E",
      subtle: "#6C675F",
      accent: "#B3C69D",
      accent2: "#D5C39B",
      accentDeep: "#405234",
      wood: "#B98B70",
      inverse: "#405234",
      border: "rgba(64,82,52,.14)",
      glass: "rgba(255,253,248,.78)",
      glassStrong: "rgba(255,253,248,.94)",
      skyTop: "#F5F1E8",
      skyMid: "#DCE6CB",
      skyBottom: "#B5C59E",
      hill1: "#D1DDBD",
      hill2: "#9EAF87",
      hill3: "#607554",
      water: "#E9DFD1",
      line: "rgba(255,253,248,.48)",
      shadow: "rgba(55,43,34,.16)",
      warning: "#D5C39B",
      danger: "#B98B70",
    },
  },
  {
    id: "spring-sage",
    name: "Spring Sage",
    short: "Spring Sage",
    group: "Light green",
    description:
      "노란 기가 도는 연두와 맑은 세이지 중심. Moss Cream보다 가볍고 Bright Forest보다 초록 면적과 채도가 절제됩니다.",
    note: "가장 산뜻하고 봄빛이 강함.",
    swatches: ["#EFF3E4", "#FFFDF8", "#AFC595", "#D4C58F", "#B98B6E", "#405447"],
    palette: {
      canvas: "#EFF3E4",
      canvasDeep: "#D9D0C1",
      shell: "#FBF7EE",
      surface: "#FFFDF8",
      surface2: "#F8F3E9",
      surface3: "#E9EEDC",
      text: "#2D332D",
      muted: "#555950",
      subtle: "#666B5F",
      accent: "#AFC595",
      accent2: "#D4C58F",
      accentDeep: "#405447",
      wood: "#B98B6E",
      inverse: "#334238",
      border: "rgba(64,84,71,.14)",
      glass: "rgba(255,253,248,.77)",
      glassStrong: "rgba(255,253,248,.94)",
      skyTop: "#F3F4E6",
      skyMid: "#DDE8C8",
      skyBottom: "#B9CC9D",
      hill1: "#D4E0B9",
      hill2: "#AFC595",
      hill3: "#6E8A6B",
      water: "#E8E5CF",
      line: "rgba(255,253,248,.48)",
      shadow: "rgba(55,43,34,.16)",
      warning: "#D4C58F",
      danger: "#B98B6E",
    },
  },
  {
    id: "bright-forest",
    name: "Bright Forest",
    short: "Bright Forest",
    group: "Green-led",
    description:
      "세이지·유칼립투스·모스 면적과 채도가 가장 높은 테마. Spring Sage보다 깊고 풍성한 숲·식물 인상이 강합니다.",
    note: "초록 면적과 채도가 가장 높음.",
    swatches: ["#E1EBE0", "#FEFEFB", "#83A381", "#C6BD80", "#B88466", "#3F493E"],
    palette: {
      canvas: "#E1EBE0",
      canvasDeep: "#C9D8C8",
      shell: "#F5F7F1",
      surface: "#FEFEFB",
      surface2: "#F0F5EE",
      surface3: "#E7EFE4",
      text: "#283128",
      muted: "#505B50",
      subtle: "#646C64",
      accent: "#83A381",
      accent2: "#C6BD80",
      accentDeep: "#3F493E",
      wood: "#B88466",
      inverse: "#2B352B",
      border: "rgba(55,73,54,.14)",
      glass: "rgba(254,254,251,.78)",
      glassStrong: "rgba(254,254,251,.93)",
      skyTop: "#E9F1E6",
      skyMid: "#CADBC7",
      skyBottom: "#A6BAA2",
      hill1: "#B9CBB5",
      hill2: "#8EA88A",
      hill3: "#5D795B",
      water: "#D8E4D3",
      line: "rgba(247,250,243,.48)",
      shadow: "rgba(55,43,34,.16)",
      warning: "#D6BF7D",
      danger: "#B57964",
    },
  },
  {
    id: "ivory-sage",
    name: "Ivory Sage",
    short: "Ivory Sage",
    group: "Neutral sage",
    description:
      "크림·아이보리 중심에 세이지가 분명하게 남는 뉴트럴 테마. Oatwood Cream보다 온도가 중립적이고 초록의 존재감이 큽니다.",
    note: "밝고 차분하지만 세이지가 분명함.",
    swatches: ["#EEEAE0", "#FFFDF8", "#9AA68A", "#CBBE88", "#BD8E70", "#4A443D"],
    palette: {
      canvas: "#EEEAE0",
      canvasDeep: "#DDD6C7",
      shell: "#F8F7F1",
      surface: "#FFFDF8",
      surface2: "#F6F3EC",
      surface3: "#EEE9E0",
      text: "#2F2A25",
      muted: "#5D554E",
      subtle: "#6D6760",
      accent: "#9AA68A",
      accent2: "#CBBE88",
      accentDeep: "#4A443D",
      wood: "#BD8E70",
      inverse: "#342F29",
      border: "rgba(74,68,61,.13)",
      glass: "rgba(255,253,248,.78)",
      glassStrong: "rgba(255,253,248,.94)",
      skyTop: "#F1EDE5",
      skyMid: "#DCD8CC",
      skyBottom: "#BDB9AA",
      hill1: "#D0CBC0",
      hill2: "#AAA79B",
      hill3: "#77766F",
      water: "#E9E3D8",
      line: "rgba(255,253,248,.50)",
      shadow: "rgba(55,43,34,.16)",
      warning: "#CBBE88",
      danger: "#BD8E70",
    },
  },
  {
    id: "oatwood-cream",
    name: "Oatwood Cream",
    short: "Oatwood Cream",
    group: "Warm neutral",
    description:
      "오트밀·크림·라이트 우드가 중심인 가장 따뜻한 테마. Ivory Sage보다 녹색 비중이 낮고 가구·공간과 자연스럽게 섞입니다.",
    note: "가장 따뜻하고 우드 비중이 높음.",
    swatches: ["#F0EAE0", "#FFFCF7", "#B3AE99", "#D1C194", "#B98B70", "#5F5349"],
    palette: {
      canvas: "#F0EAE0",
      canvasDeep: "#DCCFC0",
      shell: "#FBF7F1",
      surface: "#FFFCF7",
      surface2: "#F8F2EA",
      surface3: "#EFE7DD",
      text: "#342D27",
      muted: "#5E544B",
      subtle: "#6F655C",
      accent: "#B3AE99",
      accent2: "#D1C194",
      accentDeep: "#5F5349",
      wood: "#B98B70",
      inverse: "#41372F",
      border: "rgba(95,83,73,.13)",
      glass: "rgba(255,252,247,.78)",
      glassStrong: "rgba(255,252,247,.94)",
      skyTop: "#F4EFE8",
      skyMid: "#DED3C5",
      skyBottom: "#B6A99C",
      hill1: "#D7CEC2",
      hill2: "#B3A698",
      hill3: "#82766C",
      water: "#EBE0D4",
      line: "rgba(255,252,247,.48)",
      shadow: "rgba(55,43,34,.16)",
      warning: "#D1C194",
      danger: "#B98B70",
    },
  },
];
