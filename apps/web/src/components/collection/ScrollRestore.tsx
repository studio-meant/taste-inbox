"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Put the board back where it was.
 *
 * Two different obligations, and they pull in opposite directions:
 *
 * - **Changing a filter must not reset scroll** (`FRONTEND_COMPONENT_ARCHITECTURE.md` §15,
 *   "no full scroll reset"). Every filter link already passes `scroll={false}`, so this
 *   only has to avoid undoing that.
 * - **Coming back to a board must land where it was left** (IA §7.3). Browsers restore
 *   scroll on back for a full page load, but a client-side navigation away and back does
 *   not, so the position has to be recorded.
 *
 * Keyed on pathname alone, deliberately: `/style` filtered and `/style` unfiltered are the
 * same board being narrowed, and restoring to a position from a longer list would drop the
 * user into whitespace. Filtering keeps the current scroll because nothing moves it;
 * returning restores the last one recorded for that board.
 *
 * `sessionStorage`, not `localStorage` — a scroll position is worth exactly one session and
 * should not outlive the tab.
 */
export function ScrollRestore() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const key = `taste-inbox:scroll:${pathname}`;
    let leavingForItem = false;
    let restoreFrame = 0;
    let settledFrame = 0;

    // Restore after two paints. Next can apply its own scroll after the first paint, and
    // the board's images/grid may not have established their height yet; one frame let
    // both races put the saved position back at the top.
    const stored = sessionStorage.getItem(key);
    if (stored !== null) {
      const target = Number.parseInt(stored, 10);
      if (Number.isFinite(target) && target > 0) {
        restoreFrame = requestAnimationFrame(() => {
          settledFrame = requestAnimationFrame(() => {
            window.scrollTo({ top: target, behavior: "instant" });
          });
        });
      }
    }

    let frame = 0;
    function record(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        sessionStorage.setItem(key, String(Math.round(window.scrollY)));
      });
    }

    function rememberBeforeItemNavigation(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href^="/items/"]');
      if (anchor === null) return;

      // Capture phase runs before Next changes routes or resets scroll. Cleanup used to
      // run late enough to overwrite the correct value with the new page's zero.
      leavingForItem = true;
      sessionStorage.setItem(key, String(Math.round(window.scrollY)));
    }

    window.addEventListener("scroll", record, { passive: true });
    document.addEventListener("click", rememberBeforeItemNavigation, true);
    return () => {
      window.removeEventListener("scroll", record);
      document.removeEventListener("click", rememberBeforeItemNavigation, true);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(settledFrame);
      // Record on the way out too: a filter change unmounts this before the last scroll
      // event has been flushed. Item navigation is the exception: its position was saved
      // synchronously above, and writing here could replace it with Next's reset-to-zero.
      if (!leavingForItem) {
        sessionStorage.setItem(key, String(Math.round(window.scrollY)));
      }
    };
    // `search` is in the dependency list so a filter change re-runs the effect and keeps
    // recording, but the storage key ignores it — see the note above.
  }, [pathname, search]);

  return null;
}
