import type { SourcePlatform } from "@taste-inbox/shared";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { boardsAreAnAxis, visibleBrowseModes } from "@/lib/navigation/edition";
import { cx } from "@/lib/cx";
import { toUrlObject, type RawSearchParams } from "@/lib/filters/board-filters";
import { canNarrowByDay, formatDayShort, type CollectedDay } from "@/lib/filters/collected-days";
import type { BoardCounts } from "@/lib/repository/types";
import { CollectionCalendar } from "./CollectionCalendar";
import { ContextualRail } from "./ContextualRail";
import type { FilterGroup } from "./FilterChipRow";
import { platformLabel } from "./source-vocabulary";
import styles from "./CollectionRail.module.css";

/**
 * The rail beside every Browse board — `reference/ref.js` `Rail`, `ref.css` `.context-rail`.
 *
 * Three blocks, in the reference's order: what kinds of thing are saved, where they came
 * from, and the actions at the bottom of the panel. Underneath the paint the important
 * change is that **it always renders**. `ContextualRail` returning null when no facet could
 * narrow the board is what collapsed `/style` to two pixels — the rail is the layout's left
 * column, and a column that is sometimes absent is a layout that is sometimes absent. Board
 * counts always exist, so the panel always has something to say.
 *
 * The second rule, which the reference cannot supply: **a filter that would narrow nothing
 * is rendered as a count, not as a control.** Every Style item is from Instagram, so an
 * Instagram filter would answer with the same board — which reads as "no matches", a claim
 * about the items rather than about the product (DESIGN.md §3.5). The row still says how
 * many there are; it simply is not a link.
 *
 * The reference's `Connections` and `Archived` rows are not ported as such: neither route
 * exists, and a rail entry that 404s is worse than an absent one. The row *shape* is
 * ported as `actions`, and `/music` fills it with the archive toggle it already has.
 *
 * A fourth block sits under 출처 as of 2026-08-10: 수집한 날, the calendar. It obeys the
 * same two rules as the source facet — it is a control when it can narrow the board and a
 * count when it cannot, and it is built from the *unfiltered* board so that selecting a
 * day never removes the day you selected.
 */

/**
 * Dot colour per platform, from the theme registry.
 *
 * The reference assigns by position — `--sun`, `--wood`, `--light-green`, `#8AA1B1` — which
 * repaints every source the moment one is added or removed. Keyed by platform instead, so a
 * source's colour is stable. LinkedIn's `#8AA1B1` is the only unnamed colour on the
 * reference screen and DESIGN.md §20 forbids a hex outside the theme registry, so it takes
 * `--sage`, the nearest muted token. Decorative either way: the label carries the identity
 * and the dot is `aria-hidden` (CLAUDE.md §6).
 */
const SOURCE_DOT: Readonly<Record<SourcePlatform, string>> = {
  github: "--sun",
  instagram: "--wood",
  threads: "--light-green",
  linkedin: "--sage",
  huggingface: "--orchid",
  arxiv: "--light-wood",
  web: "--muted",
};

export interface RailSource {
  readonly platform: SourcePlatform;
  readonly label: string;
  readonly count: number;
}

export interface RailAction {
  readonly label: string;
  /** A route that exists. Nothing here links somewhere the product has not built. */
  readonly href: string;
  readonly icon: LucideIcon;
  /** Whether the board is currently in this state, so the fill is never the only signal. */
  readonly on?: boolean;
}

export function CollectionRail({
  pathname,
  params,
  counts,
  sources,
  groups,
  days = [],
  actions = [],
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  /** Board sizes, from the same `getBoardCounts()` the mode strip already uses. */
  readonly counts: BoardCounts;
  /** Every source on this board, counted. Complete whether or not it can filter. */
  readonly sources: readonly RailSource[];
  /** The facets that can actually separate this board. May be empty. */
  readonly groups: readonly FilterGroup[];
  /**
   * Every day this board collected something, counted — from the board *before* any
   * filter is applied.
   *
   * Unfiltered on purpose, and the same choice `sources` makes: a calendar built from the
   * filtered board would hold exactly one day the moment a day was picked, which by the
   * rule below would turn the calendar into a static count — with the selected day no
   * longer clickable, and therefore no longer clearable.
   */
  readonly days?: readonly CollectedDay[];
  readonly actions?: readonly RailAction[];
}) {
  const byMode: Readonly<Record<string, number>> = {
    // All is the complete visible collection: four filed boards plus the no-board inbox.
    // This is the same population `/library` renders and Today's Saved Items links to.
    all: counts.ai + counts.style + counts.music + counts.places + counts.none,
    trends: counts.ai,
    style: counts.style,
    music: counts.music,
    places: counts.places,
    none: counts.none,
  };

  // The source facet appears as a filter when it can narrow and as a count when it cannot.
  // Exactly one of the two renders, so a source is never listed twice.
  const sourcesAreFilters = groups.some((group) => group.key === "source");
  const showSourceCounts = !sourcesAreFilters && sources.length > 0;
  const showFacets = groups.length > 0;
  // The same split, one block down: a calendar over a single day answers every click with
  // the board that is already on screen, so that day is stated rather than offered.
  const dayIsFilter = canNarrowByDay(days);
  const onlyDay = dayIsFilter ? undefined : days[0];

  /*
   * `Browse by type` is a board list, and a board list is only a filter where the boards
   * can differ. In the `rnd` edition they cannot: `Trends` holds everything the collectors
   * produce, `None` holds nothing, and the three Instagram boards do not fill at all — so
   * the block offered `All 135 / Trends 135 / None 0`, three rows that answer with the same
   * screen (`lib/navigation/edition.ts`). The Inbox's real axes are below it: what kind of
   * artifact, where it came from, and when it arrived.
   *
   * **Hidden, not removed.** `/trends` and `/none` still exist and still render; a tree
   * without the marker — the personal workspace, where all five boards fill — draws the
   * block exactly as before.
   */
  const boardModes = boardsAreAnAxis() ? visibleBrowseModes() : [];

  return (
    <nav className={styles.rail} aria-label="Inbox 필터">
      {boardModes.length === 0 ? null : (
        <section className={styles.section}>
          <h2 className={styles.label} lang="en">
            Browse by type
          </h2>
          <ul className={styles.list}>
            {boardModes.map((mode) => {
              const count = byMode[mode.id] ?? 0;
              const active = pathname === mode.href || pathname.startsWith(`${mode.href}/`);
              const name = `${mode.label} ${String(count)}개`;
              return (
                <li key={mode.id}>
                  <Link
                    className={cx(styles.row, active ? styles.rowOn : null)}
                    href={mode.href}
                    /* A board is a destination, unlike a filter — so `page`, matching
                     GlobalNavPill and the mode tabs. */
                    aria-current={active ? "page" : undefined}
                    /* Collapsed, only the glyph shows, so both are mandatory (DESIGN.md
                     §11.2) — and the count travels in the name rather than in colour. */
                    aria-label={name}
                    title={name}
                  >
                    <span className={styles.glyph} aria-hidden="true" lang="en">
                      {mode.label.slice(0, 1)}
                    </span>
                    <span className={styles.text} lang="en">
                      {mode.label}
                    </span>
                    <span className={styles.count} aria-hidden="true">
                      {count.toLocaleString("ko-KR")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {showSourceCounts ? (
        <>
          <hr className={styles.divider} />
          {/* Hidden in the collapsed column: a stack of unlabelled coloured dots says
              nothing, and unlike the rows above these have no tooltip to fall back on. */}
          <section className={cx(styles.section, styles.wideOnly)}>
            <h2 className={styles.label} lang="en">
              Source
            </h2>
            <ul className={styles.list}>
              {sources.map((source) => (
                <li key={source.platform}>
                  <span className={cx(styles.row, styles.rowStatic)}>
                    <span className={styles.glyph} aria-hidden="true">
                      <span
                        className={styles.dot}
                        style={{ ["--dot-color" as string]: `var(${SOURCE_DOT[source.platform]})` }}
                      />
                    </span>
                    <span className={styles.text}>{source.label}</span>
                    <span className={styles.count}>{source.count.toLocaleString("ko-KR")}개</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {showFacets ? (
        <>
          <hr className={styles.divider} />
          <ContextualRail pathname={pathname} params={params} groups={groups} />
        </>
      ) : null}

      {dayIsFilter ? (
        <>
          <hr className={styles.divider} />
          <CollectionCalendar pathname={pathname} params={params} days={days} />
        </>
      ) : null}

      {onlyDay === undefined ? null : (
        <>
          <hr className={styles.divider} />
          {/* Hidden collapsed for the same reason the source counts are: a lone calendar
              glyph in a 68px column says nothing, and this row has no tooltip to fall
              back on because it is not a control. */}
          <section className={cx(styles.section, styles.wideOnly)}>
            <h2 className={styles.label}>수집한 날</h2>
            <ul className={styles.list}>
              <li>
                <span className={cx(styles.row, styles.rowStatic)}>
                  <span className={styles.glyph} aria-hidden="true">
                    <CalendarDays className={styles.actionIcon} strokeWidth={1.75} />
                  </span>
                  <span className={styles.text}>{formatDayShort(onlyDay.day)}</span>
                  <span className={styles.count}>{onlyDay.count.toLocaleString("ko-KR")}개</span>
                </span>
              </li>
            </ul>
          </section>
        </>
      )}

      {actions.length === 0 ? null : (
        <>
          <hr className={styles.divider} />
          <ul className={styles.list}>
            {actions.map((action) => {
              const Icon = action.icon;
              const name = action.on === true ? `${action.label}, 켜짐` : action.label;
              return (
                <li key={action.label}>
                  <Link
                    className={cx(styles.row, action.on === true ? styles.rowOn : null)}
                    href={toUrlObject(action.href)}
                    scroll={false}
                    aria-label={name}
                    title={name}
                  >
                    <span className={styles.glyph} aria-hidden="true">
                      <Icon className={styles.actionIcon} strokeWidth={1.75} />
                    </span>
                    <span className={styles.text}>{action.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </nav>
  );
}

/**
 * Every source on a board, counted — for the rail, whether or not it can filter.
 *
 * `lib/filters/facets.ts` deliberately drops a group that cannot separate the board, which
 * is right for a filter and wrong for a list of where things came from. This counts the
 * same field without that judgement.
 */
export function railSources(
  items: readonly { readonly source: { readonly platform: SourcePlatform } }[],
): readonly RailSource[] {
  const counts = new Map<SourcePlatform, number>();
  for (const item of items) {
    counts.set(item.source.platform, (counts.get(item.source.platform) ?? 0) + 1);
  }
  return [...counts]
    .map(([platform, count]) => ({ platform, label: platformLabel(platform), count }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
}
