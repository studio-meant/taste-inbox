import styles from "./ContextBar.module.css";
import { LiveClock } from "./LiveClock";

/**
 * The thin app bar — DESIGN.md §11.3, IA §4.
 *
 *   ● Suzie            [Today] [Browse]                8:42 PM   ◎
 *     Local                                     Friday, August 8
 *
 * Three slots, always in the same order, so the bar never rearranges between screens.
 * The centre slot takes the pill on workspace screens and sub-tabs on collection
 * screens; the shell does not decide which.
 *
 * Both outer slots are two-line stacks in the approved reference: identity over its
 * ground on the left, time over date on the right. The second line is the quiet one —
 * it is context for the line above it, never the only place a fact appears.
 *
 * Server Component: the interactive parts arrive as children.
 */
export interface ContextBarProps {
  /** Display name shown next to the avatar. */
  readonly profileName?: string;
  /**
   * The quiet second line under the name. Defaults to `Local`, which is the literal
   * truth about this product: one host, no account, nothing leaving the machine.
   */
  readonly profileSubLabel?: string;
  /** Replaces the profile chip with a back or breadcrumb control. */
  readonly start?: React.ReactNode;
  /** Usually `<GlobalNavPill />` or the collection's sub-tabs. */
  readonly center?: React.ReactNode;
  /** Search, privacy and the system attention entry. */
  readonly end?: React.ReactNode;
  /** Already-formatted date string. Formatting belongs to the caller's locale/timezone. */
  readonly dateLabel?: string;
  /**
   * Already-formatted clock string, shown above the date. Optional: without it the bar
   * shows the date alone rather than inventing a time in the wrong zone.
   */
  readonly timeLabel?: string;
}

function initialOf(name: string): string {
  // `Array.from` so a multi-byte first character is not split.
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

export function ContextBar({
  profileName,
  profileSubLabel = "Local",
  start,
  center,
  end,
  dateLabel,
  timeLabel,
}: ContextBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.start}>
        {start ??
          (profileName === undefined ? null : (
            // Presentational until Settings exists. The chip becomes a link by passing
            // `start` rather than by this component learning about routes.
            <span className={styles.profile}>
              <span className={styles.avatar} aria-hidden="true">
                {initialOf(profileName)}
              </span>
              <span className={styles.profileCopy}>
                <strong className={styles.profileName}>{profileName}</strong>
                <small className={styles.profileSub}>{profileSubLabel}</small>
              </span>
            </span>
          ))}
      </div>

      <div className={styles.center}>{center}</div>

      <div className={styles.end}>
        {dateLabel === undefined && timeLabel === undefined ? null : (
          <span className={styles.timeCopy}>
            {timeLabel === undefined ? (
              // A date with no clock over it stays exactly that. Handing `LiveClock` a
              // time here would be inventing one, which this bar has never done.
              <small className={styles.date}>{dateLabel}</small>
            ) : (
              /* The server's values are the first paint; `LiveClock` only takes over the
                 tick, so this hydrates byte-identical and works without JavaScript. */
              <LiveClock
                initialTime={timeLabel}
                initialDate={dateLabel}
                timeClassName={styles.time}
                dateClassName={styles.date}
              />
            )}
          </span>
        )}
        {end}
      </div>
    </header>
  );
}
