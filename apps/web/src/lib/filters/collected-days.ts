import type { FilterGroup } from "@/components/collection/FilterChipRow";
import { APP_LOCALE, APP_TIME_ZONE } from "@/lib/format/datetime";

/**
 * The day an item was collected — grouped the way Today groups it.
 *
 * **Which field.** `source.firstSeenAt`: when the item entered *this* product. It is the
 * field the Inbox sorts on, and the one the platform cannot revise underneath us — a link
 * added by hand has no star time, but every item has a first-seen time.
 *
 * **Which day.** The local calendar day in `APP_TIME_ZONE`, never the UTC date. Seoul is
 * UTC+9, so everything starred between 00:00 and 09:00 KST carries the *previous* UTC date. `apps/api/.../today.py`
 * `_local_day` makes the same conversion for the Today screen and for the collection
 * schedule, and this mirrors it deliberately: a board that disagreed with Today about
 * which day something arrived would be two screens contradicting each other over one row.
 *
 * Two differences from `_local_day`, both deliberate:
 *
 * - It accepts any timestamp `Date` can read, where the Python side insists on the exact
 *   `YYYY-MM-DDTHH:MM:SSZ` shape its writers produce. That strictness exists there because
 *   `_highlights_for` selects a day with a *string range* on the column, which only works
 *   for one fixed-width format. Nothing here compares strings, and mock fixtures carry
 *   millisecond and `+09:00` spellings of the same instants — so this accepts a superset.
 *   Live data is the canonical shape, so the two agree on every row the service produces.
 * - A stamp with no zone at all is read as UTC, not as machine-local, for the reason
 *   `_local_day` gives: reading it as local would move the boundary by however far this
 *   host happens to be from UTC.
 *
 * An unreadable stamp is left out rather than guessed onto a day. The calendar is then
 * short by exactly the rows nobody can place, which is the honest failure.
 */

/** One day that actually collected something, and how much. */
export interface CollectedDay {
  /** `YYYY-MM-DD` in `APP_TIME_ZONE`. */
  readonly day: string;
  readonly count: number;
}

interface HasFirstSeen {
  readonly source: { readonly firstSeenAt: string };
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;
/** `Z`, `+09:00` or `+0900` at the end — anything that pins the stamp to a real instant. */
const HAS_ZONE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

const LOCAL_DAY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function part(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

/** The local calendar day a timestamp falls on, or `null` if it cannot be read. */
export function localDay(iso: string): string | null {
  const stamped = HAS_ZONE.test(iso) || !iso.includes("T") ? iso : `${iso}Z`;
  const at = new Date(stamped);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  const parts = LOCAL_DAY_PARTS.formatToParts(at);
  const [year, month, day] = [part(parts, "year"), part(parts, "month"), part(parts, "day")];
  return year === "" || month === "" || day === "" ? null : `${year}-${month}-${day}`;
}

/**
 * Whether a URL carried a real day.
 *
 * Shape *and* calendar: `2026-02-30` matches the pattern and is not a date, and a filter
 * for a day that cannot exist would silently show an unfiltered board.
 */
export function isDayKey(value: string): boolean {
  if (!DAY_KEY_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const at = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (
    at.getUTCFullYear() === year && at.getUTCMonth() === (month ?? 1) - 1 && at.getUTCDate() === day
  );
}

/** Whether a URL carried a real month — the calendar's own view state, `YYYY-MM`. */
export function isMonthKey(value: string): boolean {
  if (!MONTH_KEY_PATTERN.test(value)) {
    return false;
  }
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/**
 * Every day that collected something, oldest first, counted.
 *
 * Only days with items appear. A run of zero rows between two collection days reads as a
 * broken collector when it usually means the user saved nothing — the same call
 * `today.py::_previous_days` makes about its own list.
 */
export function collectedDays(items: readonly HasFirstSeen[]): readonly CollectedDay[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const day = localDay(item.source.firstSeenAt);
    if (day !== null) {
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** The months those days fall in, oldest first, each appearing once. */
export function collectedMonths(days: readonly CollectedDay[]): readonly string[] {
  return [...new Set(days.map((entry) => monthOf(entry.day)))].sort();
}

/**
 * Whether a day filter could separate this board — `facets.ts::isUseful`, specialised.
 *
 * That rule reads "more than one value, and at least one value smaller than the whole
 * board". For days the first half implies the second: two days each hold fewer items than
 * the two together, so `days.length > 1` is the same test. One day holding everything
 * narrows nothing, and a calendar whose single live day answers with the same board is a
 * control that cannot do anything — the rail renders it as a count instead.
 */
export function canNarrowByDay(days: readonly CollectedDay[]): boolean {
  return days.length > 1;
}

const MONTH_LABEL = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
});
const DAY_LABEL = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
});
const DAY_NAME = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "long",
});
const DAY_SHORT = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "short",
});

/*
 * Formatted from a UTC midnight, in UTC. These keys are already local calendar dates —
 * converting them a second time would move `2026-08-08` to the 7th on any host west of
 * Seoul, which is the very mistake `localDay` exists to prevent.
 */
function midnight(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** `2026년 8월` */
export function formatMonthLabel(month: string): string {
  return MONTH_LABEL.format(midnight(`${month}-01`));
}

/** `8월 8일` */
export function formatDayLabel(day: string): string {
  return DAY_LABEL.format(midnight(day));
}

/** `8월 8일 토요일` — the calendar cell's accessible name. */
export function formatDayName(day: string): string {
  return DAY_NAME.format(midnight(day));
}

/** `8월 8일 (토)` — one day, said in a rail row. */
export function formatDayShort(day: string): string {
  return DAY_SHORT.format(midnight(day));
}

/**
 * A month laid out as weeks of seven, Sunday first, with `null` where the month is not.
 *
 * Computed on `Date.UTC` triples rather than on local `Date`s: which weekday the 1st falls
 * on is a property of the calendar, not of a timezone, and building it from local dates
 * would shift the grid by a day on hosts either side of UTC.
 */
export function monthWeeks(month: string): readonly (readonly (number | null)[])[] {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1, 1));
  const length = new Date(Date.UTC(year ?? 1970, index ?? 1, 0)).getUTCDate();

  const cells: (number | null)[] = Array.from<null>({ length: first.getUTCDay() }).fill(null);
  for (let day = 1; day <= length; day += 1) {
    cells.push(day);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: (number | null)[][] = [];
  for (let start = 0; start < cells.length; start += 7) {
    weeks.push(cells.slice(start, start + 7));
  }
  return weeks;
}

/**
 * The selected day, as the chip row's own group.
 *
 * The calendar lives in the rail, and the rail is desktop-only — `Board.module.css` hides
 * the chips at 768px and up, and shows the rail there instead. Without this, a `?day=`
 * link opened on a phone would be a filter with no control anywhere on the screen: nothing
 * to click off, and (unless it happened to match nothing, which is the one case
 * `NoMatches` covers) no way back to the whole board. One chip, only while a day is
 * actually selected, is the smallest thing that keeps the filter removable everywhere it
 * can be arrived at.
 *
 * Not offered as a list of every collected day: 142 chips is not a filter bar, and the
 * calendar is the surface built for choosing among days.
 */
export function dayFilterGroups(
  selected: string | null,
  days: readonly CollectedDay[],
): readonly FilterGroup[] {
  if (selected === null) {
    return [];
  }
  const count = days.find((entry) => entry.day === selected)?.count ?? 0;
  return [
    {
      key: "day",
      legend: "수집한 날",
      options: [{ value: selected, label: formatDayLabel(selected), count }],
    },
  ];
}
