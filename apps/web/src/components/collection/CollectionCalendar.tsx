import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "@/lib/cx";
import {
  CALENDAR_MONTH_KEY,
  DAY_KEY,
  firstValue,
  parseCalendarMonth,
  toUrlObject,
  toggleFilterHref,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import {
  collectedMonths,
  formatDayName,
  formatMonthLabel,
  monthOf,
  monthWeeks,
  type CollectedDay,
} from "@/lib/filters/collected-days";
import styles from "./CollectionCalendar.module.css";

/**
 * 수집한 날 — the rail block under 출처, filtering the board by the day an item arrived.
 *
 * **A month at a time, and only months that collected something.** The real data is
 * sparse and stays sparse: a one-time backfill shares a single timestamp and each run
 * since stamps its own, so a month with two live days is the normal picture, not a
 * degenerate one. The previous/next links step to the previous and next *month with
 * items* rather than to the adjacent calendar month, so paging can never land on an empty
 * grid and every collected day is reachable in as many clicks as there are months.
 *
 * **A day with nothing is not a control.** Only days that have items are links; the rest
 * are plain numerals. That is the same rule `facets.ts::isUseful` states for a whole
 * facet, applied per cell — an option that always returns nothing reads as "no matches",
 * a claim about the items rather than about the product (DESIGN.md §3.5).
 *
 * **Single-select**, like the rail's source rows: a click filters to that day, and
 * clicking the selected day clears it (`toggleFilterHref(..., "single")`). With the
 * "필터 지우기" control gone that re-click is the way back to the whole board, so it is
 * load-bearing rather than a convenience.
 *
 * **Links, not buttons**, for the reason `ContextualRail` gives: the filter works before
 * hydration, middle-click opens a filtered board in a new tab, hover shows where it goes,
 * and browser back undoes it with no state to keep in sync. Nothing here is a Client
 * Component.
 *
 * **Three channels, none of them colour** (CLAUDE.md §6, DESIGN.md §18):
 *
 * - a day with items is a *link* and a day without is text — the difference a screen
 *   reader and the Tab key both get, before any pixel is painted;
 * - a day with items is underlined, which is a shape and survives a greyscale screen;
 * - the selected day says "선택됨" in its accessible name and is bold, since the filled
 *   tile alone would be colour.
 *
 * A day with no items carries a `title` as well, so a pointer user gets the same answer
 * the link's name gives ("8월 3일 · 수집한 항목 없음") instead of a numeral that silently
 * refuses to be clicked.
 *
 * **Where it renders.** Wide rail only (≥1280px), like the source counts above it: seven
 * columns cannot be laid out in the 68px collapsed column, and below 768px the rail is not
 * on screen at all. `dayFilterGroups` in `lib/filters/collected-days` is what keeps the
 * filter removable on the narrow surfaces — the selected day appears there as a chip.
 *
 * Cells are 24×24 with no gap, which is WCAG 2.2 AA target size (2.5.8) exactly. The
 * rail's own 44px row floor cannot apply here: seven 44px columns is 308px inside a 200px
 * panel. This is a pointer-only surface at that width, and the same day is reachable at
 * 44px from the chip on every touch surface.
 */
export function CollectionCalendar({
  pathname,
  params,
  days,
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  /** Every day this board collected something, from the **unfiltered** board. */
  readonly days: readonly CollectedDay[];
}) {
  const months = collectedMonths(days);
  // Newest, because the newest thing collected is what a person came to look at — and its
  // absence is the same fact as an empty board, so one guard covers both.
  const newest = months[months.length - 1];
  if (newest === undefined) {
    return null;
  }

  const selected = firstValue(params[DAY_KEY]);
  /*
   * `?cal=` wins over the selected day's month. The other order reads better on arrival —
   * the calendar opens on the day you picked — but it also pins the calendar there: the
   * previous-month link would set `cal` and the selected day would immediately override
   * it, so the pager would appear to do nothing.
   */
  const requested = parseCalendarMonth(params);
  const fallback = selected === null ? null : monthOf(selected);
  const month =
    (requested !== null && months.includes(requested) ? requested : null) ??
    (fallback !== null && months.includes(fallback) ? fallback : null) ??
    newest;

  const index = months.indexOf(month);
  const previous = index > 0 ? months[index - 1] : undefined;
  const next = index < months.length - 1 ? months[index + 1] : undefined;

  const counts = new Map(days.map((entry) => [entry.day, entry.count]));

  return (
    <section className={cx(styles.section, styles.wideOnly)}>
      <h2 className={styles.label}>수집한 날</h2>

      <div className={styles.head}>
        <MonthStep pathname={pathname} params={params} month={previous} direction="previous" />
        <span className={styles.month}>{formatMonthLabel(month)}</span>
        <MonthStep pathname={pathname} params={params} month={next} direction="next" />
      </div>

      <table className={styles.grid}>
        <caption className="visually-hidden">{`${formatMonthLabel(month)}에 수집한 날`}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday.short} scope="col" className={styles.weekday} abbr={weekday.long}>
                {weekday.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month).map((week, weekIndex) => (
            // The week has no identity of its own; its position in the month is the key.
            <tr key={`${month}-w${String(weekIndex)}`}>
              {week.map((date, dateIndex) => {
                if (date === null) {
                  return <td key={`${month}-w${String(weekIndex)}-${String(dateIndex)}`} />;
                }

                const day = `${month}-${String(date).padStart(2, "0")}`;
                const count = counts.get(day);
                const name = formatDayName(day);

                if (count === undefined) {
                  return (
                    <td key={day} className={styles.cell}>
                      <span
                        className={cx(styles.day, styles.dayEmpty)}
                        title={`${name} · 수집한 항목 없음`}
                      >
                        {date}
                      </span>
                    </td>
                  );
                }

                const isOn = selected === day;
                const label = `${name} ${String(count)}개`;
                const said = isOn ? `${label}, 선택됨` : label;

                return (
                  <td key={day} className={styles.cell}>
                    <Link
                      className={cx(styles.day, styles.dayHas, isOn && styles.dayOn)}
                      href={toUrlObject(toggleFilterHref(pathname, params, DAY_KEY, day, "single"))}
                      scroll={false}
                      /* The cell shows a numeral; the name and the tooltip carry the rest,
                         the way every other rail row does (DESIGN.md §11.2). */
                      aria-label={said}
                      title={said}
                    >
                      {date}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * One step of the pager, or the space where it would be.
 *
 * Rendered as an inert span when there is no earlier/later month with items rather than
 * omitted, so the month title keeps its place instead of sliding as you page.
 */
function MonthStep({
  pathname,
  params,
  month,
  direction,
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  readonly month: string | undefined;
  readonly direction: "previous" | "next";
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  if (month === undefined) {
    return <span className={cx(styles.step, styles.stepOff)} aria-hidden="true" />;
  }

  const name = `${formatMonthLabel(month)} 보기`;
  return (
    <Link
      className={styles.step}
      href={toUrlObject(toggleFilterHref(pathname, params, CALENDAR_MONTH_KEY, month, "single"))}
      scroll={false}
      aria-label={name}
      title={name}
    >
      <Icon className={styles.stepIcon} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}

/**
 * Sunday first, the Korean calendar convention.
 *
 * Written out rather than derived from `Intl`, because the column header has to be one
 * character wide at 24px and `Intl` short weekday names are not that in every locale build.
 * `abbr` gives the full name to a screen reader reading the column.
 */
const WEEKDAYS = [
  { short: "일", long: "일요일" },
  { short: "월", long: "월요일" },
  { short: "화", long: "화요일" },
  { short: "수", long: "수요일" },
  { short: "목", long: "목요일" },
  { short: "금", long: "금요일" },
  { short: "토", long: "토요일" },
] as const;
