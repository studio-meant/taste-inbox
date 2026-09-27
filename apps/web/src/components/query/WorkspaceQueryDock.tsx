"use client";

import { usePathname } from "next/navigation";
import { findActiveDestination } from "@/lib/navigation/routes";
import { TasteQueryDock } from "./TasteQueryDock";

/**
 * Mounts the Taste Query Dock on workspace routes only.
 *
 * System and Settings share the same `AppShell` but are not places to ask questions of
 * the library — the System layout says so in its own comment. A route outside the
 * navigation model (an error boundary, a not-found) gets no dock either: the safe default
 * is nothing.
 *
 * **The Lab is the exception, and it is the interesting one.** `/focus/[itemId]` renders
 * the same dock itself, live, as `What do you want to know?` (`LabQueryDock`) — in the
 * panel between the research it is asked about and the plan it produces. Mounting the
 * floating read-only one here as well would put two composers on one screen, one of which
 * says questions are not open while the other takes them.
 *
 * A Client Component for one reason: it reads the current route.
 */
export function WorkspaceQueryDock() {
  const pathname = usePathname();
  const destination = findActiveDestination(pathname);

  if (pathname.startsWith("/focus/")) return null;
  if (destination?.id !== "today" && destination?.id !== "browse") {
    return null;
  }

  return <TasteQueryDock />;
}
