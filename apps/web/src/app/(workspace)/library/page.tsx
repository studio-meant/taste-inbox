import type { AIItemCardModel } from "@taste-inbox/shared";
import { LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import { AIItemCard } from "@/components/ai/AIItemCard";
import { AddLinkButton } from "@/components/collection/AddLinkButton";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { browseCardSize, browseSpanClass, isPortrait } from "@/components/collection/BrowseCard";
import { CollectionRail, railSources } from "@/components/collection/CollectionRail";
import { FilterChipRow } from "@/components/collection/FilterChipRow";
import { FilterSheet } from "@/components/collection/FilterSheet";
import { NoMatches } from "@/components/collection/NoMatches";
import { ScrollRestore } from "@/components/collection/ScrollRestore";
import { MusicShelfCard } from "@/components/music/MusicItemCard";
import { EmptyState } from "@/components/primitives";
import { StyleItemCard } from "@/components/style/StyleItemCard";
import {
  leadIndex,
  mergeBoards,
  mergedItems,
  type MergedEntry,
} from "@/lib/collection/merged-board";
import { cx } from "@/lib/cx";
import {
  activeFilterCount,
  boardViewHref,
  isUnfiltered,
  parseLibraryFilters,
  unknownFilterValues,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import { collectedDays, dayFilterGroups } from "@/lib/filters/collected-days";
import { aiFilterGroups, sourceFilterGroups } from "@/lib/filters/facets";
import { boardPickerOffered } from "@/lib/navigation/edition";
import { getRepository } from "@/lib/repository";
import { isRemoteReadOnly } from "@/lib/remote-mode";
import styles from "@/components/collection/Board.module.css";

export const metadata: Metadata = { title: "Inbox · Taste Inbox R&D" };

/**
 * Inbox — the canonical collection route (IA §3), and now actually all of it.
 *
 * **`Browse` is the route; `Inbox` is what a person reads.** The name changed on
 * 2026-09-28 with the product's own IA: this screen is not exploration in general, it is
 * where the R&D interest signals a person left on GitHub and Hugging Face gather and get
 * connected, and `Inbox → Lab` is the structure the whole product is named after. The
 * route stays `/library` — renaming a stable route days before a submission buys a diff
 * and risks a dead bookmark.
 *
 * This route used to carry the real chrome over an empty state, and its reason was
 * recorded here: a merged board needs one card grammar that fits an AI post, a fashion
 * carousel and a Reel with five candidate songs in the same 300px column, and the third
 * does not fit. The observation was right; the conclusion did not follow. **Nothing
 * requires one grammar.** Each item renders with the component its own board already uses —
 * `AIItemCard`, `StyleItemCard`, `MusicShelfCard` — and the problem dissolves into two
 * questions a merge really does have to answer:
 *
 * - **What order.** Newest first by `source.firstSeenAt`, the one field every model shares,
 *   ties broken by id so the server and the client agree (`lib/collection/merged-board`).
 * - **How much room.** Browse cards keep their span grammar. Music keeps the same square
 *   sleeve used on `/music`, aligned to two browse row units rather than expanding into a
 *   separate full-width review row.
 *
 * Everything else this board does, it does the way `/trends` does it: one facet, parsed from
 * the URL and handed to every repository call, an `EmptyState` when there is nothing
 * and `NoMatches` when a filter matched nothing.
 */
/** The day filter, spread into a repository query only when there is one. */
function day(selected: string | null): { readonly day?: string } {
  return selected === null ? {} : { day: selected };
}

const CATEGORY_CLASS: Readonly<Record<MergedEntry["board"], string>> = {
  trends: styles.libraryTrends ?? "",
  style: styles.libraryStyle ?? "",
  music: styles.libraryMusic ?? "",
  places: styles.libraryPlaces ?? "",
  none: styles.libraryNone ?? "",
};

export default async function LibraryPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/library", params);

  const repository = getRepository();
  /*
   * Three lists and the counts. That is four requests on a page, which the render budget
   * allows — `tests/render-budget.test.ts` guards the *workspace layout*, which pays for
   * every navigation in the group; this page pays only when someone opens it.
   *
   * Fetched unfiltered as well, for the same reason `/trends` does: the rail has to say how
   * many items a source would bring back, not only how many survived the filter already
   * applied.
   *
   * Music keeps its default `handled` filter, so this board shows what `/music` shows.
   */
  const [ai, style, music, places, none, counts] = await Promise.all([
    repository.listAIItems({ limit: 200 }),
    repository.listStyleItems({ limit: 200 }),
    repository.listMusicItems({ limit: 200 }),
    repository.listPlacesItems({ limit: 200 }),
    repository.listDeclinedItems({ limit: 200 }),
    repository.getBoardCounts(),
  ]);
  const all = mergeBoards({
    ai: ai.items,
    style: style.items,
    music: music.items,
    places: places.items,
    none: none.items,
  });

  /*
   * Whether `종류` is a question this board can answer, decided by looking at it.
   *
   * `kind` lives on `AIItemCardModel`, which is what `/trends`, `/places` and `/none`
   * produce; a Style carousel and a Music sleeve have no such field. So the facet is honest
   * exactly when those two lists are empty — then every row on the merged board carries a
   * kind, and filtering by it filters all of it. When they are not empty the facet is not
   * offered and not parsed, because a board answering `?kind=paper` with fashion carousels
   * is the failure docs/DECISIONS.md (2026-08-08) calls worse than no filter at all.
   *
   * In this edition that is every render — the collectors that fill Style and Music do not
   * run — and the Inbox holds repositories, models, datasets, Spaces and papers, which is
   * precisely a board that needs the axis.
   */
  const kindIsAnAxis = style.items.length === 0 && music.items.length === 0;
  const filters = parseLibraryFilters(params, { withKind: kindIsAnAxis });
  const kind = "kind" in filters && filters.kind.length > 0 ? { kind: filters.kind } : {};

  // The filter goes to every list, never to some of them. A board answering `?source=github`
  // with Instagram Reels contradicts the link it came from, which docs/DECISIONS.md
  // (2026-08-08) names as the worse failure — worse than not offering the filter at all.
  // `kind` is the exception that proves it: it is only ever set when the two lists that
  // cannot take it are empty, so there is nothing for it to pass silently through.
  const narrowed = isUnfiltered(filters)
    ? null
    : await Promise.all([
        repository.listAIItems({
          limit: 200,
          source: filters.source,
          ...kind,
          ...day(filters.day),
        }),
        repository.listStyleItems({ limit: 200, source: filters.source, ...day(filters.day) }),
        repository.listMusicItems({ limit: 200, source: filters.source, ...day(filters.day) }),
        repository.listPlacesItems({
          limit: 200,
          source: filters.source,
          ...kind,
          ...day(filters.day),
        }),
        repository.listDeclinedItems({
          limit: 200,
          source: filters.source,
          ...kind,
          ...day(filters.day),
        }),
      ]);
  const page =
    narrowed === null
      ? all
      : mergeBoards({
          ai: narrowed[0].items,
          style: narrowed[1].items,
          music: narrowed[2].items,
          places: narrowed[3].items,
          none: narrowed[4].items,
        });

  /*
   * `종류` first, then `출처`. The Inbox's own order: a person scanning it is looking for a
   * paper or a repository before they are looking for a platform, and `aiFilterGroups`
   * already drops the kind axis when one source yields only one kind.
   */
  const groups = kindIsAnAxis
    ? aiFilterGroups(mergedItems(all) as readonly AIItemCardModel[])
    : sourceFilterGroups(mergedItems(all));
  // Across every board, from the unfiltered merge: this route's calendar has to agree with
  // the boards it merges, and it is the only place a day can span them.
  const days = collectedDays(mergedItems(all));
  const chipGroups = [...groups, ...dayFilterGroups(filters.day, days)];
  const lead = leadIndex(page);
  /*
   * `Trends ▾` on every card, or `Open in Lab` on every card. Not both: they share the
   * slot under the tags, and in this edition the picker's five options are one board
   * holding everything and three that cannot fill (`lib/navigation/edition.ts`).
   */
  const picker = boardPickerOffered();
  // Seed fixtures on one board and collected items on another would be a board that is
  // half sample data, so it only claims "수집됨" when every board agrees.
  const collected = [ai, style, music, places, none].every((board) => board.origin === "collected");

  return (
    <div className={styles.page}>
      <ScrollRestore />
      <BoardHeader
        title="Inbox"
        lead="내가 남긴 R&D 관심 신호를 모으고, 관련 논문·레포·모델·데모를 연결합니다."
        /* What is on screen, counted from what is on screen. The rail's `All` row comes
           from `getBoardCounts()`, which counts the music board without the `handled`
           filter this page applies; the two agree while nothing has been cleared and, when
           they stop agreeing, the honest number is the one over the cards. */
        total={page.length}
        collected={collected}
        actions={isRemoteReadOnly() ? undefined : <AddLinkButton />}
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/library"
          params={params}
          counts={counts}
          sources={railSources(mergedItems(all))}
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

          {all.length === 0 ? (
            <EmptyState
              as="h2"
              icon={LayoutGrid}
              title="아직 들어온 관심 신호가 없어요"
              description="GitHub Star와 Hugging Face Like · Upvote에서 수집되면 여기에 모입니다."
            />
          ) : page.length === 0 ? (
            <NoMatches pathname="/library" params={params} dropped={unknownFilterValues(params)} />
          ) : (
            <ul className={cx(styles.board, styles.browseBoard)}>
              {page.map((entry, index) => {
                if (entry.board === "music") {
                  // The dedicated Music board's square sleeve belongs here too. Its
                  // details drawer keeps every candidate without turning the mixed grid
                  // back into occasional full-width rows.
                  return (
                    <li key={`${entry.board}-${entry.item.id}`} className={CATEGORY_CLASS.music}>
                      <MusicShelfCard item={entry.item} index={index} returnHref={returnHref} />
                    </li>
                  );
                }

                /*
                 * `browseCardSize`'s `index === 0` rule means "the newest item leads the
                 * board". Here the newest item can be a fixed square Music sleeve, which
                 * cannot take the wide Browse-card shape — so the lead is the newest item
                 * that is not music. `index` still carries the real position, because that
                 * is what the entry stagger reads.
                 */
                const sizeIndex = index === lead ? 0 : 1;
                // Trends and Places share `AIItemCardModel` — one cover — while Style
                // carries the whole gallery. So the split is by *model*, not by board, and
                // adding a board that reuses a model does not add a branch here.
                const size =
                  entry.board === "style"
                    ? browseCardSize({
                        index: sizeIndex,
                        mediaCount: entry.item.media.length,
                        portrait: isPortrait(entry.item.media[0] ?? null),
                      })
                    : browseCardSize({
                        index: sizeIndex,
                        mediaCount: entry.item.preview === null ? 0 : 1,
                        portrait: isPortrait(entry.item.preview),
                      });

                return (
                  <li
                    key={`${entry.board}-${entry.item.id}`}
                    className={cx(browseSpanClass(size), CATEGORY_CLASS[entry.board])}
                  >
                    {entry.board === "style" ? (
                      <StyleItemCard
                        item={entry.item}
                        size={size}
                        index={index}
                        board={picker ? entry.board : undefined}
                        labHref={`/focus/${entry.item.id}`}
                        returnHref={returnHref}
                      />
                    ) : (
                      <AIItemCard
                        item={entry.item}
                        size={size}
                        index={index}
                        board={picker ? entry.board : undefined}
                        labHref={`/focus/${entry.item.id}`}
                        returnHref={returnHref}
                      />
                    )}
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
