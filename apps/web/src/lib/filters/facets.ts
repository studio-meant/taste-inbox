import { kindLabel } from "@/components/collection/source-vocabulary";
import type { AIItemCardModel } from "@taste-inbox/shared";
import type { FilterGroup } from "@/components/collection/FilterChipRow";

/**
 * Filter options counted from the items actually on the board.
 *
 * Counting rather than enumerating is the whole point. A group over a field every item
 * shares — every item from GitHub, say — would offer one option and narrow nothing, and a
 * filter that always finds nothing reads as "no matches", which is a claim about the items
 * rather than about the product — exactly the confusion DESIGN.md §3.5 exists to prevent.
 *
 * So a group appears when it can separate the board and disappears when it cannot. As
 * enrichment lands, the groups appear on their own, with no code change here.
 */

/** A value that every item shares cannot narrow anything, so it is not offered. */
function isUseful(counts: ReadonlyMap<string, number>, total: number): boolean {
  return counts.size > 1 && [...counts.values()].some((count) => count < total);
}

function tally<T>(items: readonly T[], pick: (item: T) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    if (key !== null) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Anything with a source — which is every card model on every board. */
interface HasSource {
  readonly source: { readonly platform: string };
}

/**
 * 출처, counted off whatever list it is given.
 *
 * The one facet all three boards share, so it is written once. It is also the only facet
 * `/library` can offer: the merged board holds AI posts, fashion carousels and saved Reels,
 * and where an item came from is the single question all three can answer.
 */
export function sourceFilterGroups(items: readonly HasSource[]): readonly FilterGroup[] {
  const source = tally(items, (item) => item.source.platform);
  if (!isUseful(source, items.length)) {
    return [];
  }
  return [
    {
      key: "source",
      legend: "출처",
      options: [...source].map(([value, count]) => ({
        value,
        label: PLATFORM_LABEL[value] ?? value,
        count,
      })),
    },
  ];
}

export function aiFilterGroups(items: readonly AIItemCardModel[]): readonly FilterGroup[] {
  /*
   * `종류` is back (2026-09-28). It was removed while every 저장소 came from GitHub and every
   * 게시물 from a social platform — kind was then derived from source, two controls for one
   * distinction. Hugging Face broke that: one source now yields models, datasets, Spaces
   * and the papers they cite, so "which kind" is a question the source filter cannot answer.
   *
   * Counted like every facet here, and offered only while some one source holds more than
   * one kind — on an Inbox of GitHub stars and hand-added web pages it disappears again.
   */
  const kind = tally(items, (item) => item.kind);
  const kindsBySource = new Map<string, Set<string>>();
  for (const item of items) {
    const kinds = kindsBySource.get(item.source.platform) ?? new Set<string>();
    kinds.add(item.kind);
    kindsBySource.set(item.source.platform, kinds);
  }
  // Offered only once some source yields more than one kind. While kind is a function of
  // source, the two groups would be one distinction drawn twice.
  const kindIsItsOwnAxis = [...kindsBySource.values()].some((kinds) => kinds.size > 1);
  const kindGroups: FilterGroup[] =
    kindIsItsOwnAxis && isUseful(kind, items.length)
      ? [
          {
            key: "kind",
            legend: "종류",
            options: [...kind].map(([value, count]) => ({
              value,
              label: kindLabel(value),
              count,
            })),
          },
        ]
      : [];
  return [...kindGroups, ...sourceFilterGroups(items)];
}

const PLATFORM_LABEL: Readonly<Record<string, string>> = {
  github: "GitHub",
  huggingface: "Hugging Face",
  arxiv: "arXiv",
  web: "웹",
};
