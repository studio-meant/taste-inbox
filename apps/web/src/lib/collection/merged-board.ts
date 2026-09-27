import type { AIItemCardModel, MusicItemCardModel, StyleItemCardModel } from "@taste-inbox/shared";

/**
 * Every board as one list — Browse > All.
 *
 * The route said for a while that a merged board needed one card grammar that fits an AI
 * post, a fashion carousel and a Reel with five candidate songs in the same 300px column,
 * and that the third does not fit. That reading of the problem was right and the conclusion
 * was avoidable: nothing requires one grammar. Each item keeps the card its own board
 * already uses, and the merged board owns only the two things a merge actually has to
 * decide — **what order** and **how much room**.
 *
 * Everything here is pure. The board is rendered on the server and hydrated on the client,
 * so an order that consulted a clock, a random or a viewport would reshuffle between the
 * two; and a reload that reshuffles a 148-item board is a board nobody can scan.
 */

/**
 * One item, still knowing which board it came from.
 *
 * A discriminated union rather than a common supertype: the board tag is what the page
 * switches on to pick a card, and flattening the models into a shared shape would
 * throw away exactly the fields each card exists to show.
 */
export type MergedEntry =
  | { readonly board: "trends"; readonly item: AIItemCardModel }
  | { readonly board: "style"; readonly item: StyleItemCardModel }
  | { readonly board: "music"; readonly item: MusicItemCardModel }
  /*
   * Places carries the same model as Trends, and the tag is still worth keeping: it is what
   * the merged board reads to label the entry and what a future card swap would switch on.
   * Two boards sharing a model is not two boards being the same board.
   */
  | { readonly board: "places"; readonly item: AIItemCardModel }
  /*
   * None is the visible inbox for an Instagram Like waiting for classification as well as
   * an explicit no-board decision. It uses the AI/post card model and participates in All
   * so a successfully collected item cannot disappear between Today and Browse.
   */
  | { readonly board: "none"; readonly item: AIItemCardModel };

/**
 * The one field every card model shares, and the only one a merge can sort on.
 *
 * Parsed rather than compared as a string. The boards' mappers do not all emit the
 * same spelling of the same instant — a collected item carries whatever offset the capture
 * recorded — and `"2026-08-08T13:00:00+09:00"` sorts *after* `"2026-08-08T05:00:00Z"`
 * lexically while being the same moment. An unparseable value sorts last rather than
 * throwing: a board that renders 147 of 148 items is a better answer than a board that
 * renders none.
 */
function firstSeenAt(entry: MergedEntry): number {
  const parsed = Date.parse(entry.item.source.firstSeenAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Newest first, ties broken by id.
 *
 * The tiebreak is not cosmetic. `firstSeenAt` comes from a collector run, and a run that
 * saves a page of items stamps many of them within the same second — so without a second
 * key the order among them is whatever `Array.prototype.sort` did with the input order,
 * which differs between a filtered and an unfiltered fetch. Comparing ids makes the result
 * a function of the set alone, which is what lets the server render and the client
 * hydration agree (`browseCardSize`'s docstring asks for the same property).
 *
 * `<`/`>` on the id rather than `localeCompare`: ids are opaque platform keys, the order
 * among them means nothing, and a locale-sensitive comparison would make the board depend
 * on the runtime's ICU data — server and client again.
 */
export function mergeBoards({
  ai,
  style,
  music,
  places,
  none = [],
}: {
  readonly ai: readonly AIItemCardModel[];
  readonly style: readonly StyleItemCardModel[];
  readonly music: readonly MusicItemCardModel[];
  readonly places: readonly AIItemCardModel[];
  readonly none?: readonly AIItemCardModel[];
}): readonly MergedEntry[] {
  const entries: MergedEntry[] = [
    ...ai.map((item): MergedEntry => ({ board: "trends", item })),
    ...style.map((item): MergedEntry => ({ board: "style", item })),
    ...music.map((item): MergedEntry => ({ board: "music", item })),
    ...places.map((item): MergedEntry => ({ board: "places", item })),
    ...none.map((item): MergedEntry => ({ board: "none", item })),
  ];

  return entries.sort((a, b) => {
    /*
     * Compared, not subtracted. Two unparseable timestamps both read as
     * `NEGATIVE_INFINITY`, and `-Infinity - -Infinity` is `NaN` — which is not `0`, so the
     * subtraction form returned before the id tiebreak ever ran, and the spec then coerces
     * a `NaN` comparator result to `+0`. The order among those entries fell back to
     * whatever the input happened to be, which is precisely the property this function's
     * docstring promises it does not have.
     */
    const left = firstSeenAt(a);
    const right = firstSeenAt(b);
    if (left !== right) return right > left ? 1 : -1;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
}

/**
 * Which card leads the board.
 *
 * `browseCardSize` turns `index === 0` into a two-column `wide` card, and its docstring
 * says what that rule means: *the newest item on the board leads it*. On a merged board the
 * newest item can be a Music sleeve, whose square shape is fixed — it cannot also take the
 * two-column `wide` Browse-card shape without ceasing to be the record sleeve the Music
 * board uses.
 *
 * So the lead is the newest item that is **not** music. The rule keeps its meaning (one
 * card leads, and it is the newest one eligible to) while the Music tile keeps the shape it
 * needs. Returns `-1` when every item is music, in which case the board simply has no
 * separate Browse-card lead.
 */
export function leadIndex(entries: readonly MergedEntry[]): number {
  return entries.findIndex((entry) => entry.board !== "music");
}

/**
 * The items alone, for the facet counters.
 *
 * `railSources` and `sourceFilterGroups` both count `source.platform` and neither cares
 * which board an item came from, so they take the models rather than the entries.
 */
export function mergedItems(
  entries: readonly MergedEntry[],
): readonly (AIItemCardModel | StyleItemCardModel | MusicItemCardModel)[] {
  return entries.map((entry) => entry.item);
}
