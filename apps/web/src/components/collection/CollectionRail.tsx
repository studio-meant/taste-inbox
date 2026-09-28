import type { SourcePlatform } from "@taste-inbox/shared";
import { cx } from "@/lib/cx";
import type { RawSearchParams } from "@/lib/filters/board-filters";
import type { CollectedDay } from "@/lib/filters/collected-days";
import { CollectionCalendar } from "./CollectionCalendar";
import { ContextualRail } from "./ContextualRail";
import type { FilterGroup } from "./FilterChipRow";
import { platformLabel } from "./source-vocabulary";
import styles from "./CollectionRail.module.css";

/**
 * The rail beside the Inbox — `reference/ref.js` `Rail`, `ref.css` `.context-rail`.
 *
 * What kind of artifact, where it came from, and when it arrived. **It always renders**:
 * the rail is the layout's left column, and a column that is sometimes absent is a layout
 * that is sometimes absent — a missing rail once collapsed a board to two pixels.
 *
 * **A filter that would narrow nothing is rendered as a count, not as a control.** When
 * every item is from GitHub, a GitHub filter would answer with the same list — which reads
 * as "no matches", a claim about the items rather than about the product (DESIGN.md §3.5).
 * The row still says how many there are; it simply is not a link.
 *
 * 수집한 날, the calendar, obeys the same rule and is built from the *unfiltered* Inbox so
 * that selecting a day never removes the day you selected.
 *
 * The `Browse by type` board list (All · Trends · Style · Music · Places · None) went with
 * the boards on 2026-09-28.
 */

/**
 * Dot colour per platform, from the theme registry.
 *
 * The reference assigns by position — `--sun`, `--wood`, `--light-green`, `#8AA1B1` — which
 * repaints every source the moment one is added or removed. Keyed by platform instead, so a
 * source's colour is stable. Decorative either way: the label carries the identity and the
 * dot is `aria-hidden` (CLAUDE.md §6).
 */
const SOURCE_DOT: Readonly<Record<SourcePlatform, string>> = {
  github: "--sun",
  huggingface: "--orchid",
  arxiv: "--light-wood",
  web: "--muted",
};

export interface RailSource {
  readonly platform: SourcePlatform;
  readonly label: string;
  readonly count: number;
}

export function CollectionRail({
  pathname,
  params,
  sources,
  groups,
  days = [],
}: {
  readonly pathname: string;
  readonly params: RawSearchParams;
  /** Every source in the Inbox, counted. Complete whether or not it can filter. */
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
}) {
  // The source facet appears as a filter when it can narrow and as a count when it cannot.
  // Exactly one of the two renders, so a source is never listed twice.
  const sourcesAreFilters = groups.some((group) => group.key === "source");
  const showSourceCounts = !sourcesAreFilters && sources.length > 0;
  const showFacets = groups.length > 0;
  /*
   * 수집한 날 is always the calendar (2026-09-28).
   *
   * It used to collapse to a single static row when the board held only one day, on the
   * reasoning that a calendar over one day answers every click with the board already on
   * screen. True, and the wrong trade: the row read as a stray line of text, while the
   * calendar shows *which* day and where it sits in the month — which is the point of the
   * block whether or not it can narrow anything. The one day is still clickable and still
   * clears on a second click, so nothing is promised that is not delivered.
   *
   * `days` is empty only on a board with nothing on it, and then the block is skipped.
   */
  const showCalendar = days.length > 0;

  return (
    <nav className={styles.rail} aria-label="Inbox 필터">
      {showSourceCounts ? (
        <>
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
          {showSourceCounts ? <hr className={styles.divider} /> : null}
          <ContextualRail pathname={pathname} params={params} groups={groups} />
        </>
      ) : null}

      {showCalendar ? (
        <>
          {showSourceCounts || showFacets ? <hr className={styles.divider} /> : null}
          <CollectionCalendar pathname={pathname} params={params} days={days} />
        </>
      ) : null}
    </nav>
  );
}

/**
 * Every source in the Inbox, counted — for the rail, whether or not it can filter.
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
