import { LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import { AIItemCard } from "@/components/ai/AIItemCard";
import { AddLinkButton } from "@/components/collection/AddLinkButton";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { browseSpanClass } from "@/components/collection/BrowseCard";
import { CollectionRail, railSources } from "@/components/collection/CollectionRail";
import { FilterChipRow } from "@/components/collection/FilterChipRow";
import { FilterSheet } from "@/components/collection/FilterSheet";
import { NoMatches } from "@/components/collection/NoMatches";
import { ScrollRestore } from "@/components/collection/ScrollRestore";
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
import { isRemoteReadOnly } from "@/lib/remote-mode";
import styles from "@/components/collection/Board.module.css";

export const metadata: Metadata = { title: "Inbox · Taste Inbox R&D" };

/**
 * Inbox — every signal a person left on GitHub and Hugging Face, and the links that connect
 * them.
 *
 * **`/library` is the route; `Inbox` is what a person reads.** Renaming a stable route
 * buys a diff and risks a dead bookmark, so the URL stayed when the name changed.
 *
 * One list since 2026-09-28. It used to merge five boards — Trends, Style, Music, Places,
 * None — each with its own card model, and decide a kind facet by checking whether the two
 * boards that could not carry one were empty. The boards went with Instagram; what is left
 * is the list and its three axes: what kind of artifact, where it came from, and the day it
 * arrived. Each is parsed from the URL and handed to the repository, an `EmptyState` shows
 * when there is nothing and `NoMatches` when a filter matched nothing.
 */
export default async function LibraryPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/library", params);
  const filters = parseAIFilters(params);

  const repository = getRepository();
  /*
   * The whole Inbox as well as the filtered view: the rail has to say how many items a
   * source or a day would bring back, not only how many survived the filter already applied.
   */
  const all = await repository.listAIItems({ limit: 200 });
  const page = isUnfiltered(filters)
    ? all
    : await repository.listAIItems({
        limit: 200,
        kind: filters.kind,
        source: filters.source,
        ...(filters.day === null ? {} : { day: filters.day }),
      });

  // `종류` first, then `출처` — a person scanning the Inbox looks for a paper or a
  // repository before a platform.
  const groups = aiFilterGroups(all.items);
  const days = collectedDays(all.items);
  const chipGroups = [...groups, ...dayFilterGroups(filters.day, days)];

  return (
    <div className={styles.page} data-dense-screen>
      <ScrollRestore />
      <BoardHeader
        title="Inbox"
        lead="내가 남긴 R&D 관심 신호를 모으고, 관련 논문·레포·모델·데모를 연결합니다."
        total={page.items.length}
        collected={all.origin === "collected"}
        actions={isRemoteReadOnly() ? undefined : <AddLinkButton />}
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/library"
          params={params}
          sources={railSources(all.items)}
          groups={groups}
          days={days}
        />

        <div>
          <div className={styles.controls}>
            <FilterSheet
              pathname="/library"
              params={params}
              groups={chipGroups}
              activeCount={activeFilterCount(filters)}
            />
            <FilterChipRow pathname="/library" params={params} groups={chipGroups} />
          </div>

          {all.items.length === 0 ? (
            <EmptyState
              as="h2"
              icon={LayoutGrid}
              title="아직 들어온 관심 신호가 없어요"
              description="GitHub Star와 Hugging Face Like · Upvote에서 수집되면 여기에 모입니다."
            />
          ) : page.items.length === 0 ? (
            <NoMatches pathname="/library" params={params} dropped={unknownFilterValues(params)} />
          ) : (
            <ul className={cx(styles.board, styles.browseBoard)}>
              {page.items.map((item, index) => (
                <li key={item.id} className={cx(browseSpanClass("small"), styles.libraryTrends)}>
                  <AIItemCard
                    item={item}
                    size="small"
                    index={index}
                    labHref={`/focus/${item.id}`}
                    returnHref={returnHref}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
