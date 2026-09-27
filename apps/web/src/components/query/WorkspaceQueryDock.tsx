"use client";

import { usePathname } from "next/navigation";
import { findActiveDestination } from "@/lib/navigation/routes";
import { TasteQueryDock } from "./TasteQueryDock";

/**
 * Mounts the Taste Query Dock on workspace routes only.
 *
 * System and Settings share the same `AppShell` but are not places to ask questions of
 * the library — the System layout says so in its own comment, and the reference gives
 * the dock to Today, Browse and Focus alone. A route outside the navigation model
 * (an error boundary, a not-found) gets no dock either: the safe default is nothing.
 *
 * A Client Component for one reason: it reads the current route.
 */
export function WorkspaceQueryDock() {
  const destination = findActiveDestination(usePathname());

  if (destination?.id !== "today" && destination?.id !== "browse") {
    return null;
  }

  return <TasteQueryDock />;
}
