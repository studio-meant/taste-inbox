import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BROWSE_MODES, type BrowseMode } from "./browse-modes";

/**
 * Which Browse modes this tree can ever fill.
 *
 * Style, Music and Places are filled by the browser collectors alone — Instagram saves and
 * the Reels in them. The `rnd` edition does not run those (`.taste-inbox-community`:
 * `browserAutomation: false`, docs/DECISIONS.md 2026-09-28), so the three boards would sit
 * at a permanent zero in the rail and read as "you saved nothing", which is a claim about
 * the person rather than about the build. NVIDIA_HACKATHON_PLAN §6.2: the rail shows
 * All · Trends · None there.
 *
 * **Hidden from the rail, not removed.** The routes, the boards and their components stay
 * (CLAUDE.md §2 forbids redesigning the core navigation), a bookmarked `/style` still opens,
 * and a tree without the marker — the personal workspace — shows all six as before.
 */

/** Boards whose only producer is a browser collector. */
const BROWSER_ONLY_BOARDS: ReadonlySet<string> = new Set(["style", "music", "places"]);

interface Marker {
  readonly browserAutomation?: unknown;
}

function readMarker(root: string): Marker | null {
  const path = join(root, ".taste-inbox-community");
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    // An unreadable marker is not permission to hide anything.
    return null;
  }
}

/** The repository root, from `apps/web` where Next runs; overridable for other layouts. */
function repositoryRoot(): string {
  return process.env.TASTE_INBOX_REPO_ROOT ?? join(process.cwd(), "..", "..");
}

export function browserBoardsCollected(root: string = repositoryRoot()): boolean {
  const marker = readMarker(root);
  return marker?.browserAutomation !== false;
}

export function visibleBrowseModes(
  root: string = repositoryRoot(),
): readonly Omit<BrowseMode, "count">[] {
  if (browserBoardsCollected(root)) return BROWSE_MODES;
  return BROWSE_MODES.filter((mode) => !BROWSER_ONLY_BOARDS.has(mode.id));
}
