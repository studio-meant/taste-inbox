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

/**
 * Whether a board is a question this build can ask a person.
 *
 * In the `rnd` edition it is not, and that is a fact about the data rather than a design
 * preference. Style, Music and Places are filled by browser collectors this tree does not
 * run, so a per-card `Trends ▾` offers five options of which three are permanently empty
 * and a fourth — `Trends` — is where 135 of 135 items already are. A control whose only
 * real move is "file this nowhere" is noise on every card, and it sits exactly where the
 * Inbox's one useful action belongs (`Open in Lab`, docs/next_step UI §1.4).
 *
 * **Hidden, not removed.** `/none` still exists and still assigns a board, the picker
 * component is untouched, and a tree without the marker — the personal workspace, where
 * all five boards fill — draws it on every card exactly as before.
 */
export function boardPickerOffered(root: string = repositoryRoot()): boolean {
  return browserBoardsCollected(root);
}

/**
 * Whether the board list can separate the Inbox, and so deserves the rail's first block.
 *
 * Same fact as above, read from the other side: with three of five boards unable to fill,
 * `All 135 / Trends 135 / None 0` is three rows that answer with the same screen. What the
 * Inbox can actually be narrowed by — artifact kind, source, the day it arrived — is
 * counted off the board itself and sits where this used to (`lib/filters/facets.ts`).
 */
export function boardsAreAnAxis(root: string = repositoryRoot()): boolean {
  return browserBoardsCollected(root);
}

export function visibleBrowseModes(
  root: string = repositoryRoot(),
): readonly Omit<BrowseMode, "count">[] {
  if (browserBoardsCollected(root)) return BROWSE_MODES;
  return BROWSE_MODES.filter((mode) => !BROWSER_ONLY_BOARDS.has(mode.id));
}
