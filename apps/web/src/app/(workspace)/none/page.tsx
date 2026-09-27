import type { Metadata } from "next";
import { CircleSlash } from "lucide-react";
import { AIItemCard } from "@/components/ai/AIItemCard";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { browseCardSize, browseSpanClass, isPortrait } from "@/components/collection/BrowseCard";
import { CollectionRail, railSources } from "@/components/collection/CollectionRail";
import { ScrollRestore } from "@/components/collection/ScrollRestore";
import { FilterChipRow } from "@/components/collection/FilterChipRow";
import { FilterSheet } from "@/components/collection/FilterSheet";
import { NoMatches } from "@/components/collection/NoMatches";
import { EmptyState } from "@/components/primitives";
import { cx } from "@/lib/cx";
import {
  activeFilterCount,
  boardViewHref,
  isUnfiltered,
  parseStyleFilters,
  unknownFilterValues,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import { collectedDays, dayFilterGroups } from "@/lib/filters/collected-days";
import { sourceFilterGroups } from "@/lib/filters/facets";
import { getRepository } from "@/lib/repository";
import styles from "@/components/collection/Board.module.css";

export const metadata: Metadata = { title: "None · Taste Inbox" };

/**
 * None — everything that has no visible board yet.
 *
 * ## Why a route, and not a filter or a rail toggle
 *
 * Three shapes were possible and two of them are worse for the same reason.
 *
 * Browse > All includes this shelf. That makes the number Today reports and the cards its
 * Saved Items link opens the same population, while this route remains useful as the focused
 * queue for assigning a board.
 *
 * A **rail entry alone** is the same thing as a route, minus the route. The rail entry is
 * how this is reached and it exists (`lib/navigation/browse-modes.ts`), but a rail entry has
 * to point somewhere, and the URL is where filter and scroll state live (CLAUDE.md §6). A
 * shelf that could not be linked to, bookmarked, or returned to after correcting an item
 * would be unusable for exactly the sweep it is for.
 *
 * So: a route, listed with the boards because that is where a person will look for it, and
 * carrying every convention a board carries — the rail, the filters, `NoMatches`, scroll
 * restoration — because the work done here is the same work.
 *
 * ## Two states, one visible inbox
 *
 * A null Instagram Like is waiting for automatic classification. An explicit `none` is a
 * final no-board decision and will not be retried. The query preserves that database
 * distinction even though both need the same visible place and board picker.
 *
 * ## Empty is the ordinary state
 *
 * An empty shelf means every collected Like has a visible board and nobody has explicitly
 * moved an item to None.
 *
 * A Server Component: the URL carries the filter state (CLAUDE.md §6).
 */
export default async function NonePage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/none", params);
  // The same parser `/style`, `/places` and `/library` use — 출처 and 수집한 날, the two axes
  // a saved post answers before anything has enriched it. An alias, not a copy.
  const filters = parseStyleFilters(params);

  const repository = getRepository();
  // Unfiltered as well, so a chip can say how many items it would bring back rather than
  // only how many survived the filter already applied — the shape every board uses.
  const [all, counts] = await Promise.all([
    repository.listDeclinedItems({ limit: 200 }),
    repository.getBoardCounts(),
  ]);
  const page = isUnfiltered(filters)
    ? all
    : await repository.listDeclinedItems({
        limit: 200,
        ...(filters.source.length > 0 ? { source: filters.source } : {}),
        ...(filters.day === null ? {} : { day: filters.day }),
      });

  const days = collectedDays(all.items);
  const groups = sourceFilterGroups(all.items);
  const chipGroups = [...groups, ...dayFilterGroups(filters.day, days)];

  return (
    <div className={styles.page}>
      <ScrollRestore />
      <BoardHeader
        title="None"
        lead="아직 분류되지 않았거나 어느 보드에도 두지 않은 항목이에요."
        total={page.items.length}
        collected={all.origin === "collected"}
        unenrichedNote="미분류 항목은 자동 분류가 가능해지면 보드로 이동합니다. 기다리지 않고 카드에서 직접 보드를 정할 수도 있어요."
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/none"
          params={params}
          counts={counts}
          sources={railSources(all.items)}
          groups={groups}
          days={days}
        />

        <div>
          {/* Rendered only when there is something to filter — the rule `/music` and
              `/places` follow. A control over a field nothing can separate is a control
              that does nothing. */}
          {chipGroups.length === 0 ? null : (
            <div className={styles.controls}>
              <FilterSheet
                pathname="/none"
                params={params}
                groups={chipGroups}
                activeCount={activeFilterCount(filters)}
              />
              <FilterChipRow pathname="/none" params={params} groups={chipGroups} />
            </div>
          )}

          {all.items.length === 0 ? (
            <EmptyState
              as="h2"
              icon={CircleSlash}
              title="여기 있는 항목이 없어요"
              description="아직 분류되지 않은 항목과 카드에서 보드를 None으로 바꾼 항목이 여기에 모입니다."
            />
          ) : page.items.length === 0 ? (
            <NoMatches pathname="/none" params={params} dropped={unknownFilterValues(params)} />
          ) : (
            <ul className={cx(styles.board, styles.browseBoard)}>
              {page.items.map((item, index) => {
                const size = browseCardSize({
                  index,
                  mediaCount: item.preview === null ? 0 : 1,
                  portrait: isPortrait(item.preview),
                });
                return (
                  <li key={item.id} className={browseSpanClass(size)}>
                    {/* `board="none"` presents both pending and explicit None items in the
                        same visible inbox. Pending rows remain null in the database so the
                        classifier can still resume later. */}
                    <AIItemCard
                      item={item}
                      size={size}
                      index={index}
                      board="none"
                      returnHref={returnHref}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
