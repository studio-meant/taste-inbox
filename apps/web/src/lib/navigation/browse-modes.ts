import type { Route } from "next";

/**
 * The contextual modes inside Browse.
 *
 * `Music` is here rather than in the global pill for the same reason `AI` and `Style` are:
 * it is a mode of Browse, not a fourth destination (docs/DECISIONS.md, 2026-08-08).
 *
 * **Plain data, in a plain module.** This list used to be exported from `BrowseModeTabs`,
 * which is `"use client"` — and across that boundary Next hands a Server Component a client
 * *reference* rather than the value, so `CollectionRail` and the Library page both crashed
 * with `BROWSE_MODES.map is not a function`. Both boards rendered their loading skeleton
 * forever while every unit test passed, because a jsdom test imports the module directly and
 * never crosses the boundary that breaks it.
 *
 * Anything a Server Component reads has to live in a module with no `"use client"` at the
 * top. Keeping the data here and the component there is what makes that true by construction.
 */

export interface BrowseMode {
  readonly id: string;
  readonly label: string;
  readonly href: Route;
  readonly count?: number;
}

export const BROWSE_MODES: readonly Omit<BrowseMode, "count">[] = [
  { id: "all", label: "All", href: "/library" },
  { id: "trends", label: "Trends", href: "/trends" },
  { id: "style", label: "Style", href: "/style" },
  { id: "music", label: "Music", href: "/music" },
  /*
   * Places — saved restaurants, cafés and travel spots.
   *
   * Listed while it is still empty, on purpose. A board that appears only once it has items
   * cannot be found by the person who wants to know where their saved restaurants went, and
   * the rail already prints every board's count, so an honest `0` says more than an absence.
   */
  { id: "places", label: "Places", href: "/places" },
  /*
   * None — the visible no-board inbox, not a fifth filed board.
   *
   * Listed here because this list is what the rail and the mode strip render, and the whole
   * problem it solves is reachability: an explicit `none` and an Instagram Like still
   * waiting for classification both need somewhere visible. Browse > All includes them;
   * this row opens the focused queue for assigning a board.
   *
   * It says a name and a count and nothing else — the rail prints every mode's count
   * already, so `None 12` is exactly as much of a promise as `Places 0` is.
   */
  { id: "none", label: "None", href: "/none" },
];
