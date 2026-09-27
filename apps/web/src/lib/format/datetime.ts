/**
 * Date and time formatting.
 *
 * The product is Korean-first and runs in one timezone on one host, so the locale and
 * zone are configuration, not per-call arguments. DESIGN.md §16 "Time language": show
 * relative time for recent events and an absolute date once it stops being useful.
 */

export const APP_LOCALE = "ko-KR";
export const APP_TIME_ZONE = process.env.APP_TIMEZONE ?? "Asia/Seoul";

/** `2026. 8. 8. 토` — the ContextBar's compact date (IA §7.2). */
export function formatContextBarDate(date: Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

/**
 * The clock above the date in the context bar — the reference's `8:42 PM` over
 * `Friday, August 8`.
 *
 * Rendered per request by a Server Component, so it is the time the screen was built rather
 * than a ticking clock. That is the honest reading of it: this bar says when the workspace
 * was last drawn, and every other number on the screen is from the same moment.
 */
export function formatContextBarTime(date: Date): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * `14분 전`, `3일 전`.
 *
 * DESIGN.md §16 warns against vague time language; anything older than a week gets an
 * absolute date instead, because "2개월 전" is not actionable.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const target = new Date(iso);
  const deltaMs = target.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);

  if (absMs < 60 * 1000) {
    return "방금";
  }
  if (absMs > 7 * 24 * 60 * 60 * 1000) {
    return formatDateTime(iso);
  }

  const formatter = new Intl.RelativeTimeFormat(APP_LOCALE, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (absMs >= ms) {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }
  return "방금";
}
