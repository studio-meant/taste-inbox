"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-render the current route every few seconds, for as long as this is mounted.
 *
 * Job state is the backend's (CLAUDE.md §8). The screens that show a running research or
 * trial stay Server Components and read it from the service; this only asks the route to
 * read again. The parent mounts it while something is moving and stops rendering it once
 * nothing is, so polling ends by itself when the job does — there is no client copy of
 * the job to fall out of step with the database.
 *
 * Paused while the tab is hidden: nobody is looking, and a laptop with the lid half-shut
 * should not keep a local API busy.
 */
export function RefreshWhileRunning({ intervalMs = 4000 }: { readonly intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const handle = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);

  return null;
}
