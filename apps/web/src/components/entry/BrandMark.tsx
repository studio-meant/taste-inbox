import styles from "./BrandMark.module.css";
import { cx } from "@/lib/cx";

/**
 * The four-petal wordmark — `Mark()` at ref.js:449, `.brand-mark` at ref.css:78-83.
 *
 * Four `<i>` blobs on a 2×2 grid, each a quarter turn further round with a falling
 * opacity walk. The same construction already ships as `app/icon.svg`; this is the
 * component form, which the favicon file cannot be.
 *
 * Always decorative: every place it appears, the wordmark "Taste Inbox" is beside it in
 * text. Announcing it twice would be the only thing it could add.
 */
export interface BrandMarkProps {
  /** 16px instead of 28px — the reference's `.compact`, used in the Greeting brand row. */
  readonly compact?: boolean;
  /** A caller's own module class, for the one place the size is measured in `cqw`. */
  readonly className?: string;
}

export function BrandMark({ compact = false, className }: BrandMarkProps) {
  return (
    <span
      className={cx(styles.mark, compact ? styles.compact : null, className)}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
