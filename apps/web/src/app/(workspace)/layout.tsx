import { redirect } from "next/navigation";
import {
  AppShell,
  ContextBar,
  GlobalNavPill,
  MobileBottomNav,
  WorkspaceStatusButton,
} from "@/components/shell";
import { formatContextBarDate, formatContextBarTime } from "@/lib/format/datetime";
import { getRepository } from "@/lib/repository";

/**
 * Workspace layout — frontend architecture §5 "Workspace layout".
 *
 * Owns the AppShell, the ambient canvas, the ContextBar and the global navigation.
 * Page-level rails and the Taste Query Dock are injected by the pages themselves, so
 * the shell stays identical across Today, Browse and Focus.
 *
 * `force-dynamic` because the bar shows today's date and the live system state. This is
 * a local always-on service; static prerendering would only serve a stale header.
 *
 * This layout runs on every navigation inside the workspace, so what it fetches is paid
 * for by pages that show none of it. It once pulled every board for three integers:
 * /today paid 176 KiB of board JSON and 653 SQL statements to render no cards. It now asks
 * for the jobs and the profile and nothing else — `render-budget.test.ts` fails if a list
 * of items comes back.
 */
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const repository = getRepository();
  // Board counts left with the strip that used them: the rail computes its own from the
  // page's data, so fetching them here was a second round trip for a number already on
  // screen a few pixels away.
  const [jobs, profile] = await Promise.all([repository.listJobs(), repository.getProfile()]);
  // A workspace nobody has set up has nothing to show and nobody to greet (2026-09-28).
  if (!profile.onboarded) redirect("/onboarding");
  const blocked = jobs.filter((job) => job.state === "blocked" || job.state === "failed");

  return (
    <AppShell
      /*
       * `quiet`, not `scenic`. The reference reserves full strength for Greeting and renders
       * Today, Browse and Focus through `.scenic-backdrop.quiet` — `opacity: .92` with
       * `saturate(.82) brightness(1.045)`. Sampled at seven matched points against the
       * reference capture, running these routes at full strength put every hill 10–20 per
       * channel too dark (ΔRGB 32–53); with `quiet` they land within a few units.
       */
      ambient="quiet"
      contextBar={
        <ContextBar
          profileName={profile.name ?? ""}
          timeLabel={formatContextBarTime(new Date())}
          dateLabel={formatContextBarDate(new Date())}
          /*
           * The pill alone. There used to be a second row of mode tabs under it inside
           * Browse — All / Trends / Style / Music — and it was the same four destinations
           * the rail's "Browse by type" already lists, two inches to the left of it.
           *
           * It also cost the thing it sat in. The strip rendered on Browse and not on
           * Today, so the context bar was taller on one than the other, and every board
           * met the top of the frame at a different place than Today did. One duplicated
           * control was making two screens disagree about their own proportions.
           */
          center={<GlobalNavPill />}
          end={
            <WorkspaceStatusButton
              status={blocked.length > 0 ? "attention" : "healthy"}
              count={blocked.length}
            />
          }
        />
      }
      bottomNav={<MobileBottomNav />}
    >
      {children}
    </AppShell>
  );
}
