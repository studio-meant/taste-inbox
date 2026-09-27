import { Compass, Home, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { Route } from "next";

/**
 * The navigation model — IA_WIREFRAMES.md §3 and §4.
 *
 * Three layers, and this module owns the top one:
 *
 *   1. Global destination   Today · Browse · System
 *   2. Browse mode          All Items · AI · Style · Sources · Collections · Connections
 *   3. Utility              Settings · Privacy · Command Palette
 *
 * Keeping the destination list here rather than in each component is what stops the
 * desktop pill, the mobile bar and the command palette from drifting apart.
 */

export type DestinationId = "today" | "browse" | "system";

export interface Destination {
  readonly id: DestinationId;
  readonly label: string;
  /**
   * Typed against the routes that actually exist — `typedRoutes` in `next.config.ts`
   * turns a broken destination into a build error rather than a 404 found by a user.
   */
  readonly href: Route;
  readonly icon: LucideIcon;
  /**
   * Route prefixes that count as "inside" this destination. Browse owns several
   * routes — `/library`, `/ai`, `/style` and canonical item detail — because they share
   * one shell and one interaction language (IA §3).
   */
  readonly matches: readonly string[];
  /** Sequential shortcut from IA §4, entered after `G`. */
  readonly shortcut: string;
  /**
   * Language of `label`, for `lang` on the rendered element.
   *
   * Recorded decision (2026-08-08): destination and mode names stay English as the
   * product's own nouns; everything read as a sentence, status or action is Korean.
   * Inside `<html lang="ko">` an unmarked English noun is mispronounced by a Korean
   * screen reader, so the language is part of the model rather than a styling detail.
   */
  readonly labelLang: "en" | "ko";
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "today",
    label: "Today",
    href: "/today",
    icon: Home,
    matches: ["/today", "/focus"],
    shortcut: "T",
    labelLang: "en",
  },
  {
    id: "browse",
    /*
     * `Inbox`, not `Browse` (2026-09-28).
     *
     * The id stays `browse` because it keys the route matcher, the shortcut and every
     * test; the *label* is what a person reads, and this destination is not exploration in
     * general. It is where the R&D interest signals someone left on GitHub and Hugging
     * Face gather and get connected — `Taste Inbox R&D → Inbox → Lab` is the product's own
     * structure, and `Browse` names none of it.
     */
    label: "Inbox",
    href: "/library",
    icon: Compass,
    // AI, Style, Music and Places are contextual modes inside Browse, so all of them keep
    // the Browse item active (docs/DECISIONS.md, 2026-08-08). `/none` is not a board but it
    // is browsed the same way and reached from the same rail, so it belongs to the same
    // destination — leaving it out would blank the global navigation while the user is
    // standing on it.
    matches: ["/library", "/trends", "/style", "/music", "/places", "/none", "/items"],
    shortcut: "B",
    labelLang: "en",
  },
  {
    id: "system",
    label: "System",
    labelLang: "en",
    href: "/system",
    icon: SlidersHorizontal,
    matches: ["/system", "/settings"],
    shortcut: "Y",
  },
];

/**
 * The desktop pill carries only Today and the Inbox.
 *
 * IA §4: "중앙 pill navigation은 `Today / Browse` 두 공간만 담는다." (The second is labelled
 * `Inbox` as of 2026-09-28; it is the same destination.) System is reached
 * from the right-hand status indicator, the mobile bar, or `⌘ K`.
 *
 * Note: DESIGN.md §4 "Navigation states → Today" still lists a four-item pill
 * (`Today / AI Lab / Style / Library`). That line contradicts DESIGN.md's own
 * "Primary destinations" in the same section, every wireframe in IA §7, and frontend
 * architecture §7.1 and §22 — all of which specify Today / Browse. Treated as a stale
 * remnant; see the note in docs/BOOTSTRAP.md.
 */
export const PILL_DESTINATIONS: readonly Destination[] = DESTINATIONS.filter(
  (destination) => destination.id !== "system",
);

/** Mobile uses all three as bottom navigation (IA §4 Mobile). */
export const BOTTOM_NAV_DESTINATIONS: readonly Destination[] = DESTINATIONS;

export function findActiveDestination(pathname: string): Destination | undefined {
  return DESTINATIONS.find((destination) =>
    destination.matches.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}

export function isDestinationActive(destination: Destination, pathname: string): boolean {
  return findActiveDestination(pathname)?.id === destination.id;
}
