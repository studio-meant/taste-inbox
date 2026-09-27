import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
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
  parseAIFilters,
  unknownFilterValues,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import { collectedDays, dayFilterGroups } from "@/lib/filters/collected-days";
import { aiFilterGroups } from "@/lib/filters/facets";
import { getRepository } from "@/lib/repository";
import styles from "@/components/collection/Board.module.css";

export const metadata: Metadata = { title: "Trends · Taste Inbox" };

/**
 * Trends — a Browse mode (IA §7.5), in the Saved Items layout.
 *
 * Items come from the Instagram `ai` Saved collection as well as, eventually, GitHub
 * Star. Nothing has been through an enricher, so a card shows what was collected
 * and says so.
 */
export default async function TrendsPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/trends", params);
  const filters = parseAIFilters(params);

  const repository = getRepository();
  // Fetched unfiltered as well, so a chip can show how many items it would bring back
  // rather than only how many survived the filter already applied. `getBoardCounts()` is
  // the same three-integer call the workspace layout makes — one request, 69 bytes.
  const [all, counts] = await Promise.all([
    repository.listAIItems({ limit: 200 }),
    repository.getBoardCounts(),
  ]);
  // Every group the parser understands is handed to the repository. A filter that is
  // read from the URL but not applied is worse than one that is not offered: the board
  // answers `?source=github` with Instagram items, contradicting the link it came from.
  const page = isUnfiltered(filters)
    ? all
    : await repository.listAIItems({
        limit: 200,
        ...(filters.kind.length > 0 ? { kind: filters.kind } : {}),
        ...(filters.source.length > 0 ? { source: filters.source } : {}),
        ...(filters.day === null ? {} : { day: filters.day }),
      });

  /*
   * Counted off the unfiltered board, like the chips' counts above them. `?day=` goes to
   * the repository rather than being applied over `all.items` here: the same three
   * implementations already answer `?source=`, and a filter that lived in this file would
   * be a filter the live service does not know about — honest only for as long as one
   * request happens to return the whole board.
   */
  const days = collectedDays(all.items);
  const groups = aiFilterGroups(all.items);
  const chipGroups = [...groups, ...dayFilterGroups(filters.day, days)];

  return (
    <div className={styles.page}>
      <ScrollRestore />
      <BoardHeader
        title="Trends"
        lead="따라가고 있는 것들이에요. 저장소·모델 링크가 있으면 바로 열어볼 수 있습니다."
        total={page.items.length}
        collected={all.origin === "collected"}
        unenrichedNote="게시물 원문과 거기 담긴 링크만 보여줍니다. 저장소·모델 링크가 있으면 카드에서 바로 열 수 있어요."
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/trends"
          params={params}
          counts={counts}
          sources={railSources(all.items)}
          groups={groups}
          days={days}
        />

        <div>
          <div className={styles.controls}>
            <FilterSheet
              pathname="/trends"
              params={params}
              groups={chipGroups}
              activeCount={activeFilterCount(filters)}
            />
            <FilterChipRow pathname="/trends" params={params} groups={chipGroups} />
          </div>

          {all.items.length === 0 ? (
            <EmptyState
              as="h2"
              icon={Sparkles}
              title="아직 항목이 없어요"
              description="인스타그램 저장 컬렉션이나 GitHub Star에서 수집되면 여기에 모입니다."
            />
          ) : page.items.length === 0 ? (
            <NoMatches pathname="/trends" params={params} dropped={unknownFilterValues(params)} />
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
                    <AIItemCard
                      item={item}
                      size={size}
                      index={index}
                      board="trends"
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
