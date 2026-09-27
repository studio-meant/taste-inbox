import styles from "./Skeleton.module.css";
import { cx } from "@/lib/cx";

type SkeletonShape = "text" | "media" | "card" | "pill";

export interface SkeletonProps {
  readonly shape?: SkeletonShape;
  /** Any CSS length. Defaults to filling the inline axis. */
  readonly width?: string;
  readonly height?: string;
  /** Reserve the final aspect ratio so nothing shifts when content arrives. */
  readonly aspectRatio?: string;
  readonly className?: string;
}

/**
 * Placeholder that reserves the exact space its content will occupy.
 *
 * DESIGN.md §15 and §25: loading never causes layout shift, and a skeleton is silent
 * to assistive technology — the surrounding region announces the loading state once,
 * rather than every placeholder announcing itself.
 */
export function Skeleton({ shape = "text", width, height, aspectRatio, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, styles[shape], className)}
      style={{
        width: width ?? "100%",
        height: height ?? (aspectRatio === undefined ? "1em" : undefined),
        aspectRatio,
      }}
    />
  );
}
