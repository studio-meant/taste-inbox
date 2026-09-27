import type { LucideIcon } from "lucide-react";
import styles from "./SignalChip.module.css";
import { cx } from "@/lib/cx";

/**
 * SignalChip — DESIGN.md §11.13.
 *
 * Used for filters, sources and small non-semantic states. It has no status tones on
 * purpose: DESIGN.md §11.13 warns against confusing decorative category colour with
 * semantic status colour, and keeping the two components separate is what enforces it.
 *
 * When `onClick` is given the chip becomes a real `<button>` with `aria-pressed`, so
 * selection is exposed to assistive technology rather than implied by fill.
 */

interface BaseProps {
  readonly children: React.ReactNode;
  readonly icon?: LucideIcon;
  /** Small leading dot for source or category identity. Ignored when `icon` is set. */
  readonly dot?: boolean;
  /** Token name for the dot, e.g. `"--sage"`. Never a raw colour. */
  readonly dotToken?: string;
  /** Result count shown after the label, e.g. a filter's match count. */
  readonly count?: number;
  readonly className?: string;
}

interface StaticChipProps extends BaseProps {
  readonly onClick?: undefined;
  readonly selected?: undefined;
}

interface InteractiveChipProps extends BaseProps {
  readonly onClick: () => void;
  readonly selected: boolean;
}

export type SignalChipProps = StaticChipProps | InteractiveChipProps;

export function SignalChip(props: SignalChipProps) {
  const { children, icon: Icon, dot = false, dotToken, count, className } = props;

  const content = (
    <>
      {Icon !== undefined ? (
        <Icon className={styles.icon} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      ) : dot ? (
        <span
          className={styles.dot}
          style={
            dotToken === undefined ? undefined : { ["--dot-color" as string]: `var(${dotToken})` }
          }
          aria-hidden="true"
        />
      ) : null}
      {children}
      {count === undefined ? null : (
        <span className={styles.count}>{count.toLocaleString("ko-KR")}</span>
      )}
    </>
  );

  if (props.onClick === undefined) {
    return <span className={cx(styles.chip, className)}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.selected}
      className={cx(
        styles.chip,
        styles.interactive,
        props.selected ? styles.selected : null,
        className,
      )}
    >
      {content}
    </button>
  );
}
