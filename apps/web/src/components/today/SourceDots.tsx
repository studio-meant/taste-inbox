import type { SourcePlatform } from "@taste-inbox/shared";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";

/**
 * `SourceDots` — ref.js:490, styled at ref.css:234.
 *
 * A cluster of overlapping discs, one per platform, with an optional "+n" for the rest.
 * It appears twice on Today: as the Connections card's heading accessory and as the
 * Saved card's footer.
 *
 * The reference paints each disc in the platform's brand hex. Those are not theme
 * tokens (DESIGN.md §20), so each disc takes a token ground and keeps the platform's
 * initial — which is also what stops this being a colour-only signal. The full platform
 * name stays in the accessible tree next to it, so the list reads correctly even when
 * the glyphs do not.
 */

export const SOURCE_LABEL: Readonly<Record<SourcePlatform, string>> = {
  github: "GitHub",
  huggingface: "Hugging Face",
  arxiv: "arXiv",
  threads: "Threads",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  web: "웹",
};

const SOURCE_GLYPH: Readonly<Record<SourcePlatform, string>> = {
  github: "G",
  huggingface: "H",
  arxiv: "a",
  threads: "T",
  linkedin: "in",
  instagram: "I",
  web: "W",
};

const SOURCE_DOT_CLASS: Readonly<Record<SourcePlatform, string | undefined>> = {
  github: undefined,
  huggingface: styles.sourceDotWeb,
  arxiv: undefined,
  threads: styles.sourceDotThreads,
  linkedin: styles.sourceDotLinkedin,
  instagram: styles.sourceDotInstagram,
  web: styles.sourceDotWeb,
};

export function SourceDots({
  platforms,
  label,
  max = 4,
}: {
  readonly platforms: readonly SourcePlatform[];
  /** Names the list, e.g. "수집한 출처". */
  readonly label: string;
  readonly max?: number;
}) {
  if (platforms.length === 0) {
    return null;
  }

  const shown = platforms.slice(0, max);
  const hidden = platforms.length - shown.length;

  return (
    <ul className={styles.sourceDots} aria-label={label}>
      {shown.map((platform) => (
        <li key={platform} className={cx(styles.sourceDot, SOURCE_DOT_CLASS[platform])}>
          <span aria-hidden="true">{SOURCE_GLYPH[platform]}</span>
          <span className="visually-hidden">{SOURCE_LABEL[platform]}</span>
        </li>
      ))}
      {hidden > 0 ? (
        <li className={styles.sourceDotsMore}>
          <span aria-hidden="true">{`+${String(hidden)}`}</span>
          <span className="visually-hidden">{`외 ${String(hidden)}곳`}</span>
        </li>
      ) : null}
    </ul>
  );
}
