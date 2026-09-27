import type { Metadata } from "next";
import { Shirt } from "lucide-react";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { browseCardSize, browseSpanClass, isPortrait } from "@/components/collection/BrowseCard";
import { CollectionRail, railSources } from "@/components/collection/CollectionRail";
import { ScrollRestore } from "@/components/collection/ScrollRestore";
import { FilterChipRow } from "@/components/collection/FilterChipRow";
import { FilterSheet } from "@/components/collection/FilterSheet";
import { NoMatches } from "@/components/collection/NoMatches";
import { EmptyState } from "@/components/primitives";
import { StyleItemCard } from "@/components/style/StyleItemCard";
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
import { styleFilterGroups } from "@/lib/filters/facets";
import { getRepository } from "@/lib/repository";
import styles from "@/components/collection/Board.module.css";

export const metadata: Metadata = { title: "Style · Taste Inbox" };

/**
 * Style — a Browse mode (IA §7.8), image-led, in the Saved Items layout.
 *
 * The largest of the three collections, and the board that proved the rail has to be
 * unconditional: every one of its 76 items is from Instagram, so no facet can separate it,
 * so the old rail rendered nothing and the board landed in a 2px grid track. The rail now
 * leads with board counts, which exist whatever the facets say, and lists the sources as
 * counts rather than as a filter that would return the same board.
 *
 * Stays a Server Component: the URL carries the filter state, so there is nothing to hold
 * on the client and the board renders filtered on first byte.
 */
export default async function StylePage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/style", params);
  const filters = parseStyleFilters(params);

  const repository = getRepository();
  // The unfiltered board is fetched too, so the chips can show how many items each option
  // would bring back rather than only what survived the current filter.
  const [all, counts] = await Promise.all([
    repository.listStyleItems({ limit: 200 }),
    repository.getBoardCounts(),
  ]);
  // Every group the parser understands is handed to the repository — see /trends for why a
  // parsed-but-unapplied filter is the worse failure.
  const page = isUnfiltered(filters)
    ? all
    : await repository.listStyleItems({
        limit: 200,
        ...(filters.source.length > 0 ? { source: filters.source } : {}),
        ...(filters.day === null ? {} : { day: filters.day }),
      });

  // Days come from the unfiltered board, so picking one never removes the one you picked —
  // and `?day=` is handed to the repository rather than applied here, for the reason
  // /trends states: this file is not where the live service learns about a filter.
  const days = collectedDays(all.items);
  const groups = styleFilterGroups(all.items);
  const chipGroups = [...groups, ...dayFilterGroups(filters.day, days)];

  return (
    <div className={styles.page}>
      <ScrollRestore />
      <BoardHeader
        title="Style"
        lead="저장해 둔 패션 게시물이에요."
        total={page.items.length}
        collected={all.origin === "collected"}
        unenrichedNote="사진과 캡션, 그리고 게시물에 담긴 링크를 그대로 보여줍니다. 브랜드나 가격은 확인하지 않아요."
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/style"
          params={params}
          counts={counts}
          sources={railSources(all.items)}
          groups={groups}
          days={days}
        />

        <div>
          <div className={styles.controls}>
            <FilterSheet
              pathname="/style"
              params={params}
              groups={chipGroups}
              activeCount={activeFilterCount(filters)}
            />
            <FilterChipRow pathname="/style" params={params} groups={chipGroups} />
          </div>

          {all.items.length === 0 ? (
            <EmptyState
              as="h2"
              icon={Shirt}
              title="아직 패션 항목이 없어요"
              description="인스타그램 저장 컬렉션에서 수집되면 여기에 모입니다."
            />
          ) : page.items.length === 0 ? (
            <NoMatches pathname="/style" params={params} dropped={unknownFilterValues(params)} />
          ) : (
            <ul className={cx(styles.board, styles.browseBoard)}>
              {page.items.map((item, index) => {
                const size = browseCardSize({
                  index,
                  mediaCount: item.media.length,
                  portrait: isPortrait(item.media[0] ?? null),
                });
                return (
                  <li key={item.id} className={browseSpanClass(size)}>
                    <StyleItemCard
                      item={item}
                      size={size}
                      index={index}
                      board="style"
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
