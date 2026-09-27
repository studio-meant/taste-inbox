import styles from "./Meter.module.css";
import { cx } from "@/lib/cx";

/**
 * CompactMeter — DESIGN.md §11.19.
 *
 * Used for RAM, disk, price trend and collector duration. Three properties matter:
 *
 * - **A measurement, not progress.** `role="meter"` rather than `progressbar`, because
 *   the bar reports a level, not completion.
 * - **Never colour-only.** Exceeding the budget changes the fill's *pattern*, not just
 *   its hue, so it survives greyscale and colour-blindness (DESIGN.md §18).
 * - **Unknown is a first-class state.** A missing estimate renders a hatched track and
 *   says so, instead of drawing a zero that looks like a real measurement
 *   (DESIGN.md §3.5 "Trust over confidence").
 */

export type MeterTone = "ready" | "warning" | "danger" | "neutral";

export interface MeterProps {
  readonly label: string;
  /**
   * Measured value. `null` means "not determined yet" and renders the unknown state
   * rather than a zero-length bar.
   */
  readonly value: number | null;
  readonly max: number | null;
  /** Appended to both numbers, e.g. `GB`. */
  readonly unit?: string;
  readonly tone?: MeterTone;
  /** Rendered at the end of the value line, typically a StatusPill. */
  readonly verdict?: React.ReactNode;
  /** Small line under the bar, e.g. a checked-at time. */
  readonly footnote?: React.ReactNode;
  /** Shown in place of the numbers when `value` or `max` is null. */
  readonly unknownLabel?: string;
}

const format = (value: number): string =>
  value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });

export function Meter({
  label,
  value,
  max,
  unit,
  tone = "neutral",
  verdict,
  footnote,
  unknownLabel = "확인 필요",
}: MeterProps) {
  // `aria-label` rather than `aria-labelledby`: generating an id would require the
  // `useId` hook, which would make this a Client Component for no interactive reason.
  const known = value !== null && max !== null && max > 0;
  const ratio = known ? value / max : 0;
  const over = known && value > max;
  const suffix = unit === undefined ? "" : ` ${unit}`;

  return (
    <div
      className={[styles.meter, known ? styles[tone] : styles.unknown, over ? styles.over : null]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.head}>
        <span className={cx(styles.label, "type-body-small")}>{label}</span>
        {verdict}
      </div>

      <p className={cx(styles.value, "type-body-small")}>
        {known ? (
          <>
            <strong>
              {format(value)}
              {suffix}
            </strong>
            <span className={styles.of}>
              {" / "}
              {format(max)}
              {suffix}
            </span>
          </>
        ) : (
          <span className={styles.of}>{unknownLabel}</span>
        )}
      </p>

      <div
        className={styles.track}
        role="meter"
        aria-label={label}
        aria-valuenow={known ? value : undefined}
        aria-valuemin={0}
        aria-valuemax={known ? max : undefined}
        aria-valuetext={
          known
            ? `${format(value)}${suffix} / ${format(max)}${suffix}${over ? " · 예산 초과" : ""}`
            : unknownLabel
        }
      >
        {known ? (
          <div
            className={styles.fill}
            // Clamped so an over-budget value fills the track rather than overflowing
            // it; the hatched pattern is what communicates the overflow.
            style={{ ["--meter-ratio" as string]: String(Math.min(1, Math.max(0, ratio))) }}
          />
        ) : null}
      </div>

      {footnote === undefined ? null : (
        <p className={cx(styles.footnote, "type-body-small")}>{footnote}</p>
      )}
    </div>
  );
}
