import type { Metadata } from "next";
import { MapPin } from "lucide-react";
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

export const metadata: Metadata = { title: "Places · Taste Inbox" };

/**
 * Places — a Browse mode, for the restaurants, cafés and travel spots saved on Instagram.
 *
 * **It renders `AIItemCard`, and that is a decision rather than a shortcut.** A saved place
 * is an Instagram post: a caption, a photo, the hashtags the account wrote, and whatever it
 * linked. `AIItemCard` shows exactly those and claims nothing else. The card a "places
 * board" seems to want — a rating, an address, a map, a distance — would be four fields
 * with no producer anywhere in this product, and a field with no honest producer is removed
 * rather than shipped as a null (docs/DECISIONS.md, 2026-08-09, which is the same removal
 * the AI card's execution verdict and the Style card's price went through). `StyleItemCard`
 * was the other candidate and loses on the same rule: its second half is 작성자의 판매처, a
 * purchase route this board cannot honour.
 *
 * **The board is empty in mock mode, and full only once something files into it.** No
 * platform routes here by rule — a GitHub star is never a restaurant — so the two writers
 * are `enrich/classify.py`, which gained this board on 2026-08-12, and the board picker on
 * every card. There is no committed fixture, so what a clean checkout sees is the
 * `EmptyState`; against the real service the board fills as the classifier runs.
 *
 * **No filter is drawn over a field nothing can separate.** The facets are counted off the
 * board (`lib/filters/facets.ts`), so on an empty board there are none and the controls row
 * is not rendered at all — an empty filter bar above an empty state is 16px of nothing
 * saying that a filter exists. `?source=` and `?day=` are still parsed and still handed to
 * the repository, because `/library` merges this board with the other three and answers one
 * `?day=` across all of them.
 *
 * Stays a Server Component: the URL carries the filter state (CLAUDE.md §6).
 */
export default async function PlacesPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/places", params);
  // The same parser `/style` and `/library` use: 출처 and 수집한 날, which are the only two
  // axes a saved post answers before anything has enriched it. An alias, not a copy.
  const filters = parseStyleFilters(params);

  const repository = getRepository();
  // Unfiltered as well, so a chip can say how many items it would bring back rather than
  // only how many survived the filter already applied — the shape every board uses.
  const [all, counts] = await Promise.all([
    repository.listPlacesItems({ limit: 200 }),
    repository.getBoardCounts(),
  ]);
  const page = isUnfiltered(filters)
    ? all
    : await repository.listPlacesItems({
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
        title="Places"
        lead="저장해 둔 식당·카페·여행지예요."
        total={page.items.length}
        collected={all.origin === "collected"}
        unenrichedNote="게시물 원문과 사진, 거기 담긴 링크만 보여줍니다. 주소나 평점은 확인하지 않아요."
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/places"
          params={params}
          counts={counts}
          sources={railSources(all.items)}
          groups={groups}
          days={days}
        />

        <div>
          {/* Rendered only when there is something to filter. `/music` makes the same call
              for the same reason: a control over a field nothing can separate is a control
              that does nothing. */}
          {chipGroups.length === 0 ? null : (
            <div className={styles.controls}>
              <FilterSheet
                pathname="/places"
                params={params}
                groups={chipGroups}
                activeCount={activeFilterCount(filters)}
              />
              <FilterChipRow pathname="/places" params={params} groups={chipGroups} />
            </div>
          )}

          {all.items.length === 0 ? (
            /* What will fill it, and why it is empty — not "수집되면 여기에 모입니다" like
               the other three, because no collector is on its way here. These posts are
               already collected; what is missing is the step that decides one of them is a
               restaurant. */
            <EmptyState
              as="h2"
              icon={MapPin}
              title="아직 장소가 없어요"
              description="인스타그램에 저장하거나 좋아요한 식당·카페·여행지가 여기에 모입니다. 분류가 아직 아무것도 여기로 보내지 않았어요. 다른 보드에서 잘못 들어간 게 보이면 카드에서 Places로 바꾸면 됩니다."
            />
          ) : page.items.length === 0 ? (
            <NoMatches pathname="/places" params={params} dropped={unknownFilterValues(params)} />
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
                      board="places"
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
