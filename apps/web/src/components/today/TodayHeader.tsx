import type { SourceStatusSummary } from "@taste-inbox/shared";
import { Clock } from "lucide-react";
import styles from "./Today.module.css";
import { APP_TIME_ZONE } from "@/lib/format/datetime";
import { cx } from "@/lib/cx";

/**
 * Today's page header — `.page-title-row`, ref.js:504 and ref.css:222.
 *
 *   DAILY TASTE BRIEF                                    ( Updated 8:38 PM )
 *   Today
 *
 * The eyebrow is a real label, not decoration, so it is readable text rather than an
 * `aria-hidden` flourish — but it is a sibling of the `<h1>`, not part of it, so the
 * page's accessible heading stays "Today".
 *
 * The pill is the reference's only piece of chrome on this row. Its time is derived
 * from the collectors rather than the clock: the last moment any source actually ran.
 */

/**
 * `8:38 PM`.
 *
 * English and 12-hour because the label it follows is English — the reference's
 * "Updated 8:38 PM" is one of the four structural English strings this screen keeps
 * (the rest of the copy is Korean). The zone is the product's, never the browser's.
 */
export function formatUpdatedTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    timeStyle: "short",
  }).format(new Date(iso));
}

/** The most recent `lastRunAt` across every collector, or `null` if none has run. */
export function latestRunAt(summary: SourceStatusSummary): string | null {
  let latest: string | null = null;
  for (const source of summary.sources) {
    if (source.lastRunAt === null) {
      continue;
    }
    if (latest === null || new Date(source.lastRunAt) > new Date(latest)) {
      latest = source.lastRunAt;
    }
  }
  return latest;
}

export function TodayHeader({
  sources,
  greeting,
}: {
  readonly sources: SourceStatusSummary;
  /** `TodayPayload.greeting`. Omitted when there is nothing to say. */
  readonly greeting?: string;
}) {
  const updatedAt = latestRunAt(sources);

  return (
    <div className={cx(styles.header, styles.motionItem)} style={{ ["--i" as string]: "0" }}>
      <div className={styles.titleGroup}>
        <p className={styles.eyebrow} lang="en">
          DAILY TASTE BRIEF
        </p>
        <h1 className={styles.pageTitle} lang="en">
          Today
        </h1>
        {greeting === undefined || greeting.length === 0 ? null : (
          <p className={styles.pageLead}>{greeting}</p>
        )}
      </div>

      {updatedAt === null ? null : (
        <p className={styles.updatedPill} lang="en">
          <Clock
            className={styles.updatedIcon}
            strokeWidth={1.75}
            aria-hidden="true"
            focusable="false"
          />
          {/* Text, not a tint: the time is the message, and it survives greyscale. */}
          Updated <time dateTime={updatedAt}>{formatUpdatedTime(updatedAt)}</time>
        </p>
      )}
    </div>
  );
}
