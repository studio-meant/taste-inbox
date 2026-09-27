import { Archive, Inbox, Music4 } from "lucide-react";
import type { Metadata } from "next";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { CollectionRail, railSources } from "@/components/collection/CollectionRail";
import { ScrollRestore } from "@/components/collection/ScrollRestore";
import { MusicShelfCard } from "@/components/music/MusicItemCard";
import { NoMatches } from "@/components/collection/NoMatches";
import { FilterChipRow } from "@/components/collection/FilterChipRow";
import { EmptyState } from "@/components/primitives";
import { cx } from "@/lib/cx";
import {
  boardViewHref,
  parseMusicFilters,
  unknownFilterValues,
  type RawSearchParams,
} from "@/lib/filters/board-filters";
import { collectedDays, dayFilterGroups } from "@/lib/filters/collected-days";
import { getRepository } from "@/lib/repository";
import styles from "@/components/collection/Board.module.css";

export const metadata: Metadata = { title: "Music · Taste Inbox" };

/**
 * Music — a Browse mode (docs/DECISIONS.md, 2026-08-08).
 *
 * An inbox arranged like a record shelf: every saved Reel is one square sleeve, with its
 * first identified track on the front and the full candidate list inside a disclosure.
 *
 * The board takes the same two/three/four-column rhythm as Trends, but not its variable
 * row spans: LP and CD sleeves are square, so every item keeps one stable footprint. The
 * reference's `Archived` rail row lands here as a
 * real control rather than a drawn one: `?handled=shown` is the archive this board already
 * had, and it was previously reachable only by typing the URL.
 *
 * It takes `?day=` like the other three, even though every Reel collected so far landed on
 * one day and the rail therefore states that day rather than offering a calendar. The
 * filter still has to be *applied*: `/library` merges this board with the other two and
 * answers one `?day=` across all three, and a list that accepted the parameter and ignored
 * it would put August's Reels on a board asked for October (docs/DECISIONS.md, 2026-08-08).
 */
export default async function MusicPage({
  searchParams,
}: {
  readonly searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const returnHref = boardViewHref("/music", params);
  const filters = parseMusicFilters(params);
  const repository = getRepository();
  const showingArchive = filters.handled === "shown";
  /*
   * `all` is the board as the archive toggle leaves it, before any day is picked — the
   * rail is built from it for the same reason the other three boards do it: a calendar
   * counted off the filtered board would hold exactly the day already selected, and the
   * click that clears the filter would have nothing left to click.
   *
   * `handled` is not that kind of filter. It decides which board this is (inbox or
   * archive), and both states are always offered as rail actions, so it belongs in both
   * fetches.
   */
  const [all, counts] = await Promise.all([
    repository.listMusicItems({ limit: 200, includeHandled: showingArchive }),
    repository.getBoardCounts(),
  ]);
  const page =
    filters.day === null
      ? all
      : await repository.listMusicItems({
          limit: 200,
          includeHandled: showingArchive,
          day: filters.day,
        });

  const days = collectedDays(all.items);
  // Empty until a day is actually picked, and the controls row is not rendered at all in
  // that case — an empty grid with a bottom margin is 16px of nothing above the board.
  const dayGroups = dayFilterGroups(filters.day, days);

  return (
    <div className={styles.page}>
      <ScrollRestore />
      <BoardHeader
        title="Music"
        lead={
          showingArchive
            ? "저장해 둔 노래 추천 릴스예요. 정리한 것까지 모두 보여드립니다."
            : "저장해 둔 노래 추천 릴스예요. 아직 정리하지 않은 것만 보여드립니다."
        }
        total={page.items.length}
        collected={all.origin === "collected"}
        unenrichedNote="오디오 표기·본문·표지에서 명시적으로 확인된 곡만 꺼냅니다. 애매한 감상평이나 가사 조각은 곡으로 만들지 않아요."
      />

      <div className={styles.layout}>
        <CollectionRail
          pathname="/music"
          params={params}
          counts={counts}
          sources={railSources(all.items)}
          groups={[]}
          days={days}
          /* Both states are always offered, each saying which one it is — the current one
             is named in its own accessible name, not only filled in. */
          actions={[
            { label: "정리 안 한 것", href: "/music", icon: Inbox, on: !showingArchive },
            {
              label: "정리한 것까지",
              href: "/music?handled=shown",
              icon: Archive,
              on: showingArchive,
            },
          ]}
        />

        <div>
          {/* The board's only narrow-screen filter surface, and the reason a `?day=` link
              opened on a phone is not a filter with no control: the rail and its calendar
              are not on screen below 768px. */}
          {dayGroups.length === 0 ? null : (
            <div className={styles.controls}>
              <FilterChipRow pathname="/music" params={params} groups={dayGroups} />
            </div>
          )}

          {all.items.length === 0 ? (
            <EmptyState
              as="h2"
              icon={Music4}
              title="정리할 릴스가 없어요"
              description="인스타그램에서 노래 추천 릴스를 저장 컬렉션에 넣어두면 여기에 모입니다."
            />
          ) : page.items.length === 0 ? (
            /* The board has Reels and this day has none — a different fact from an empty
               collection, and collapsing the two would tell someone they have saved
               nothing when they have only picked a quiet day. */
            <NoMatches pathname="/music" params={params} dropped={unknownFilterValues(params)} />
          ) : (
            <ul className={cx(styles.board, styles.musicBoard)}>
              {page.items.map((item, index) => (
                <li key={item.id}>
                  <MusicShelfCard item={item} index={index} returnHref={returnHref} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
