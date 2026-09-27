import Link from "next/link";
import { Check } from "lucide-react";
import { cx } from "@/lib/cx";
import {
  firstValue,
  toUrlObject,
  toggleFilterHref,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import styles from "./FilterChipRow.module.css";

/**
 * The board's filters, as links.
 *
 * Every chip is an `<a href>` to the filtered URL rather than a button with a click
 * handler. That is what makes the URL the source of truth in practice and not just in
 * principle: the chips work before hydration, middle-click opens a filtered board in a
 * new tab, hover shows where it goes, and browser back restores the previous filter with
 * no state to keep in sync (CLAUDE.md §6).
 *
 * A group with nothing behind it is not rendered at all. Showing `Outer / Top / Shoes`
 * over 76 items that were never classified would offer a filter that always returns
 * nothing, which reads as "no matches" rather than "never checked".
 *
 * **No "필터 N개 지우기" chip** since 2026-08-10. Each chip is its own undo — a second
 * click removes exactly that value — so the trailing button was a second control for a
 * job the row already did, and the one it did differently (clearing a value with no chip,
 * because nothing on the board carries it) ends on an empty board, where `NoMatches`
 * offers the way out. The one filter with no chip of its own is the day, which the rail's
 * calendar sets on wide screens and which appears here as a chip while it is active —
 * `lib/filters/collected-days::dayFilterGroups` says why.
 */

export interface FilterOption {
  readonly value: string;
  /** Korean, for the person reading it. */
  readonly label: string;
  /** How many items currently carry this value. Zero options are dropped. */
  readonly count: number;
}

export interface FilterGroup {
  readonly key: string;
  readonly legend: string;
  readonly options: readonly FilterOption[];
}

/*
 * No `aria-current` on a chip. It names the *one* current item in a set, and
 * `toggleFilterHref` keeps a comma-separated list — several chips in a group are on at
 * once, so several links would each claim to be the current one. The state travels in the
 * accessible name instead ("…, 선택됨"), which is a real second channel rather than colour
 * (CLAUDE.md §6).
 */
export function FilterChipRow({
  pathname,
  params,
  groups,
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  readonly groups: readonly FilterGroup[];
}) {
  const usable = groups
    .map((group) => ({ ...group, options: group.options.filter((option) => option.count > 0) }))
    .filter((group) => group.options.length > 0);

  if (usable.length === 0) {
    return null;
  }

  return (
    <div className={styles.row}>
      {usable.map((group) => {
        const selected = new Set((firstValue(params[group.key]) ?? "").split(","));

        return (
          <fieldset key={group.key} className={styles.group}>
            <legend className={cx(styles.legend, "type-body-small")}>{group.legend}</legend>
            <ul className={styles.chips}>
              {group.options.map((option) => {
                const isOn = selected.has(option.value);
                return (
                  <li key={option.value}>
                    <Link
                      className={cx(styles.chip, isOn && styles.chipOn, "hit-44")}
                      href={toUrlObject(
                        toggleFilterHref(pathname, params, group.key, option.value),
                      )}
                      scroll={false}
                      /* The repo's marker for "this link is the state you are in"
                         (GlobalNavPill, MobileBottomNav, BrowseModeTabs). `true` rather than
                         `page`: a filter narrows the collection, it is not a destination.
                         `aria-pressed` stood here and was discarded — role=link has no
                         pressed state. */
                    >
                      {isOn ? <Check size={13} strokeWidth={2.25} aria-hidden="true" /> : null}
                      {option.label}
                      <span className={styles.count} aria-hidden="true">
                        {option.count}
                      </span>
                      {/* One node, so the name reads "정확히 확인됨 3개, 선택됨" rather than
                          picking up a space before the comma. The Check glyph is hidden, so
                          this is the only channel that is not colour (CLAUDE.md §6). */}
                      <span className="visually-hidden">{`${String(option.count)}개${isOn ? ", 선택됨" : ""}`}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
