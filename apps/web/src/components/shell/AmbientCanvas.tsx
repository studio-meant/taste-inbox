import { cx } from "@/lib/cx";
import styles from "./AmbientCanvas.module.css";

/**
 * The scenic world behind the framed workspace.
 *
 * DESIGN.md §4 and §6: the background is nearly fixed and the foreground modules move.
 * Intensity drops as the screen becomes more content-heavy, so a collection board never
 * fights its own backdrop for contrast.
 *
 * The geometry is the approved reference's (`reference/taste-inbox-ui-ux-final.html`,
 * `Scenic()`): a sky ramp, seven stacked hills, a gradient water body and five static
 * surface lines, drawn once into a 1440×960 viewBox and stretched with
 * `preserveAspectRatio="none"`. Everything is painted from theme tokens, so the same
 * paths carry all seven palettes.
 *
 * Server Component. Purely decorative: `aria-hidden`, `pointer-events: none`, no canvas
 * element, no particle loop, no global animation frame (DESIGN.md §28 budget).
 */
export type AmbientIntensity = "scenic" | "tonal" | "quiet";

export interface AmbientCanvasProps {
  readonly intensity?: AmbientIntensity;
  /**
   * Enables the continuous glow drift.
   *
   * Off everywhere except the ceremonial Greeting: DESIGN.md §14 forbids ambient
   * animation on screens that hold content to read (resolution recorded 2026-08-08 in
   * docs/DECISIONS.md). `prefers-reduced-motion` overrides this regardless of what the
   * caller asks for.
   */
  readonly animated?: boolean;
}

/**
 * Back-to-front. The reference names them `a`…`g` and translates the whole group down
 * by 84 units; `h` exists in its stylesheet but no element ever carries it.
 */
const HILLS: readonly { readonly key: string; readonly d: string }[] = [
  {
    key: "a",
    d: "M0 192 C162 146 326 176 492 126 C660 82 834 162 1004 128 C1182 94 1308 126 1440 108 L1440 520 L0 520Z",
  },
  {
    key: "b",
    d: "M0 250 C174 212 320 232 492 188 C664 146 816 224 994 196 C1162 168 1308 194 1440 178 L1440 564 L0 564Z",
  },
  {
    key: "c",
    d: "M0 314 C178 284 332 304 510 262 C686 222 842 308 1018 278 C1186 250 1328 276 1440 262 L1440 612 L0 612Z",
  },
  {
    key: "d",
    d: "M0 384 C188 356 340 374 530 332 C718 292 876 380 1054 346 C1214 316 1346 332 1440 322 L1440 664 L0 664Z",
  },
  {
    key: "e",
    d: "M0 464 C204 430 356 448 566 404 C758 364 920 456 1104 420 C1262 390 1368 396 1440 390 L1440 716 L0 716Z",
  },
  {
    key: "f",
    d: "M0 552 C212 516 380 544 602 500 C804 460 986 548 1172 514 C1310 488 1390 492 1440 488 L1440 768 L0 768Z",
  },
  {
    key: "g",
    d: "M0 640 C234 606 402 632 646 594 C876 558 1086 636 1440 574 L1440 812 L0 812Z",
  },
];

/**
 * Five surface lines. The reference defines a sixth rule and a `waterLine` keyframe, but
 * draws neither — the water is static.
 */
const WATER_LINES: readonly string[] = [
  "M24 830 C226 818 410 838 646 826 C878 814 1074 838 1246 824",
  "M32 858 C226 846 410 866 646 854 C878 842 1074 866 1440 852",
  "M40 886 C226 874 410 894 646 882 C878 870 1074 894 1288 882",
  "M48 914 C226 902 410 922 646 910 C878 898 1074 922 1440 910",
  "M56 942 C226 930 410 950 646 938 C878 926 1074 950 1218 938",
];

const HILL_CLASS: Readonly<Record<string, string | undefined>> = {
  a: styles.hillA,
  b: styles.hillB,
  c: styles.hillC,
  d: styles.hillD,
  e: styles.hillE,
  f: styles.hillF,
  g: styles.hillG,
};

const LINE_CLASS: readonly (string | undefined)[] = [
  styles.line1,
  styles.line2,
  styles.line3,
  styles.line4,
  styles.line5,
];

export function AmbientCanvas({ intensity = "tonal", animated = false }: AmbientCanvasProps) {
  return (
    <div
      className={cx(
        styles.backdrop,
        // The reference has two states: full (Greeting) and `.quiet` (Today, Browse,
        // Focus). Our three-value prop folds onto them — only `scenic` is full strength.
        intensity === "scenic" ? null : styles.quiet,
        animated && styles.animated,
      )}
      aria-hidden="true"
    >
      <div className={styles.glow} />
      <svg
        className={styles.art}
        viewBox="0 0 1440 960"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="scenic-water-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--water)" />
            <stop
              offset="100%"
              stopColor="color-mix(in srgb, var(--surface) 86%, var(--oatmeal))"
            />
          </linearGradient>
        </defs>

        <g transform="translate(0 84)">
          {HILLS.map((hill) => (
            <path key={hill.key} className={HILL_CLASS[hill.key]} d={hill.d} />
          ))}
        </g>

        <path
          d="M0 796 C242 780 416 812 650 798 C886 784 1098 810 1440 776 L1440 960 L0 960Z"
          fill="url(#scenic-water-gradient)"
        />

        {WATER_LINES.map((d, index) => (
          <path key={d} className={cx(styles.waterLine, LINE_CLASS[index])} d={d} />
        ))}
      </svg>
      <div className={styles.vignette} />
    </div>
  );
}
