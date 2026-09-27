import type { AIItemCardModel, StyleItemCardModel } from "@taste-inbox/shared";
import type { FilterGroup } from "@/components/collection/FilterChipRow";

/**
 * Filter options counted from the items actually on the board.
 *
 * Counting rather than enumerating is the whole point. The design documents specify
 * filter groups for a product whose enrichers exist; today every one of the 126 collected
 * items is unenriched, so a `Category` group would offer Outer / Top / Shoes over items
 * that were never classified and return nothing every time. A filter that always finds
 * nothing reads as "no matches", which is a claim about the items rather than about the
 * product — exactly the confusion DESIGN.md §3.5 exists to prevent.
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
   * No `종류` group. It offered 저장소 and 게시물, and neither is a fact the source does not
   * already carry: every 저장소 on this board came from GitHub and every 게시물 came from
   * Instagram, Threads or LinkedIn. Two controls, one distinction — and the one that reads
   * as `kind` is the derived one, since `kind` is assigned *from* the platform at ingest.
   *
   * If a second platform ever yields repositories — Hugging Face models are the obvious
   * candidate — the two stop agreeing and this earns its place back.
   */
  return sourceFilterGroups(items);
}

export function styleFilterGroups(items: readonly StyleItemCardModel[]): readonly FilterGroup[] {
  // Deliberately no product axis while nothing has been priced: `stockState` is `unknown`
  // on every collected item, so the group would have one option and narrow nothing.
  return sourceFilterGroups(items);
}

const PLATFORM_LABEL: Readonly<Record<string, string>> = {
  github: "GitHub",
  huggingface: "Hugging Face",
  arxiv: "arXiv",
  threads: "Threads",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  web: "웹",
};
