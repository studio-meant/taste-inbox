import type { StatusTone } from "@taste-inbox/ui/theme";
import type { TodayPayload } from "@taste-inbox/shared";
import { APP_LOCALE } from "@/lib/format/datetime";

/**
 * Every string and number the ceremony says out loud, in one file.
 *
 * The two screens themselves are layout. What they *claim* is here, so the claims can be
 * read in one place and tested without a DOM.
 */

/**
 * The product's name, as it is said out loud.
 *
 * `Taste Inbox`, the name the landing page and the onboarding eyebrow already use. It was
 * `Taste Inbox R&D` for a day (2026-09-28) to keep the splash from reading as the music-and-
 * clothes app this tree forked from (`docs/PROVENANCE.md`); the screens after it now say
 * what the scope is — GitHub, Hugging Face, Inbox, Lab — so the suffix only made the app
 * disagree with its own landing page. One constant, so the splash, the greeting and the
 * document title cannot disagree.
 */
export const PRODUCT_NAME = "Taste Inbox";

/**
 * The only name this product has.
 *
 * It is a literal, not a setting. `packages/shared/src/domain/settings.ts` `SETTING_KEYS`
 * and the API's `LEAVES` are the same twelve keys, none of them a display name, and
 * `config/app.example.yaml` has no name field either — so nothing the user can change
 * feeds this. The one place a name is written today is
 * `app/(workspace)/layout.tsx:51`, which passes `profileName="Suzie"` to the ContextBar,
 * and it is what the app already calls the user on every workspace screen.
 *
 * This constant is therefore the *second* home for that literal and deliberately the last
 * one: the ceremony imports it rather than restating it. Giving it a real source is
 * `general.displayName` — a four-place change (pydantic `AppSection`, the API's `LEAVES`,
 * `SETTING_KEYS`, a Settings control) and, per CLAUDE.md §4, a decision to put to the user
 * before building.
 */
export const PROFILE_NAME = "Suzie";

/**
 * Used only when the payload's greeting is empty.
 *
 * `TodayPayloadSchema.greeting` is `z.string()` with no `min`, so an empty string is a
 * legal payload. `api/today.py::_greeting` never produces one, but a hand-built or
 * degraded payload can — and `Suzie님, ` with nothing after it is worse than the most
 * neutral Korean greeting there is. It claims nothing about the hour or the data.
 */
export const FALLBACK_GREETING = "안녕하세요";

/**
 * The display line — the reference's `Good evening, Suzie.` (ref.js:486).
 *
 * The time-of-day half belongs to the service: `api/today.py:50-58` picks one of four
 * Korean strings from the local hour and `TodayPayload.greeting` carries it. Re-deriving
 * it in TypeScript would give one sentence two clocks that can disagree — the frontend's
 * and the service's — so this function only composes; it never decides what time it is.
 *
 * Korean takes the vocative as a prefix, so any greeting the service sends stays
 * grammatical: `Suzie님, 좋은 아침이에요`, `Suzie님, 오늘 하루 어땠나요`.
 */
export function greetingHeadline(greeting: string, name: string | null = PROFILE_NAME): string {
  const line = greeting.trim();
  const body = line.length > 0 ? line : FALLBACK_GREETING;
  // The stored name since 2026-09-28 (onboarding); without one, the greeting alone.
  const who = name?.trim() ?? "";
  return who === "" ? body : `${who}님, ${body}`;
}

/**
 * The line under the display line.
 *
 * The reference states `오늘 새롭게 들어온 취향을 정리했어요.` unconditionally, which is
 * false on a day nothing was collected. DESIGN.md §3.5 and the honesty pattern
 * `api/today.py` follows throughout require the zero state to say so.
 */
export function entrySubline(newItems: number): string {
  // `취향` → `관심 항목` (2026-09-28). The same sentence shape, about the right thing: this
  // build collects stars, likes and paper upvotes, and 취향 sets up a music-and-clothes app.
  return newItems > 0
    ? "오늘 새로 들어온 관심 항목을 정리했어요."
    : "오늘은 아직 새로 들어온 항목이 없어요.";
}

/**
 * `8월 9일 일요일` — the eyebrow above the display line.
 *
 * Korean, not the reference's `FRIDAY · AUGUST 8`. DESIGN.md §8 keeps eyebrows Latin, but
 * that rule is about the product's own nouns (`DAILY TASTE BRIEF`, `Today`); a date is
 * not one, and the product is Korean-first (CLAUDE.md §2). The `:lang(ko)` guard that
 * `BrowseCard.module.css:178` established rides along in the stylesheet, so the Korean
 * string is neither letter-spaced nor upper-cased.
 *
 * `day` is `TodayPayload.date`, a calendar day the service already resolved in the
 * product timezone (`api/today.py::_local_day`). It is formatted at UTC noon *as UTC* on
 * purpose: projecting an already-local calendar day into another zone is how `8월 9일`
 * becomes `8월 8일`. An unparseable value is returned as-is rather than guessed at.
 */
export function formatEntryDate(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) {
    return day;
  }
  const [, year, month, date] = match;
  const noon = new Date(Date.UTC(Number(year), Number(month) - 1, Number(date), 12));
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(noon);
}

export interface EntryStatusPill {
  readonly key: string;
  readonly tone: StatusTone;
  readonly label: string;
}

/**
 * The bottom-right cluster. Two pills at most, and never the reference's middle one.
 *
 * The reference shows `17 New · 2 Ready · 1 Attention`. Only two of those three have a
 * source in this product:
 *
 * - `newItems` — `api/today.py:157`, counted from real `Item.first_seen_at` rows. Real.
 * - `readyActions` — a literal `0` at `api/today.py:159`, whose own comment says
 *   *"Nothing can be acted on until an enricher has run. Zero is the honest number, not a
 *   placeholder."* The reference's "Ready" meant a prepared execution environment
 *   (`Repo sandbox`, `arm64 · READY`), and code execution was removed at the user's
 *   decision (CLAUDE.md §8). So it is not merely zero today; it has no way back.
 * - `attention` — `api/today.py:149`, collectors sitting in `auth_required` or `blocked`.
 *   Real.
 *
 * `attention` is hidden at zero, per IA §7.1: *"status에 문제가 없으면 Attention을
 * 숨긴다."* One pill on a quiet healthy day, two when something needs a person.
 *
 * Tones are semantic, and `StatusPill` always draws an icon beside the label, so the two
 * are never told apart by colour alone (CLAUDE.md §6).
 */
export function entryStatusPills(counts: TodayPayload["counts"]): readonly EntryStatusPill[] {
  const pills: EntryStatusPill[] = [
    { key: "new", tone: "info", label: `신규 ${String(counts.newItems)}개` },
  ];
  if (counts.attention > 0) {
    pills.push({
      key: "attention",
      tone: "warning",
      label: `확인 필요 ${String(counts.attention)}개`,
    });
  }
  return pills;
}
