/**
 * Splitting the service's command list into the two blocks a person runs separately.
 *
 * `GET /api/collection/launchd` answers with one flat `string[]` holding four kinds of line
 * — Korean `#` comments, `sleep N`, `launchctl bootstrap`, `launchctl bootout` — plus one
 * empty string as a separator. There is no `{install, uninstall}` in the payload.
 *
 * This parses; it does not generate. `api/launchd.py:install_commands` stays the only thing
 * that composes a `launchctl` line, and every line below is carried through byte for byte.
 * That matters more than it looks: `gui/$(id -u)` is literal shell that must reach the
 * terminal unexpanded, `bootstrap` takes `gui/$(id -u) <path>` with a space while `bootout`
 * takes `gui/$(id -u)/<label>` with a slash, and the absolute path is the only one that
 * works when pasted. Nothing here may tidy any of that.
 *
 * The blocks are split rather than shown as one because pasting all 21 lines at once would
 * load six jobs and then immediately unload them. They are two separate things to run.
 */

export type CommandBlockId = "install" | "uninstall";

export interface CommandBlock {
  readonly id: CommandBlockId;
  /** What this block does, said on screen above it. */
  readonly heading: string;
  /** Verbatim lines, in order. Never re-wrapped, never re-quoted. */
  readonly lines: readonly string[];
}

/**
 * The one structural marker the payload has (`api/launchd.py:198`).
 *
 * Matched exactly, and the failure is designed: if the service ever stops emitting it, the
 * whole list stays in the install block and stays readable, rather than the uninstall lines
 * silently disappearing from the screen.
 */
const UNINSTALL_MARKER = "# 해제";

/** Blank lines are separators, not content — meaningful between blocks, noise at an edge. */
function trimBlankEdges(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start += 1;
  while (end > start && lines[end - 1]?.trim() === "") end -= 1;
  return lines.slice(start, end);
}

export function splitCommandBlocks(commands: readonly string[]): readonly CommandBlock[] {
  const marker = commands.findIndex((line) => line.trim() === UNINSTALL_MARKER);
  const install = trimBlankEdges(marker === -1 ? commands : commands.slice(0, marker));
  const uninstall = marker === -1 ? [] : trimBlankEdges(commands.slice(marker));

  const blocks: CommandBlock[] = [];
  if (install.length > 0) {
    blocks.push({ id: "install", heading: "등록", lines: install });
  }
  if (uninstall.length > 0) {
    blocks.push({ id: "uninstall", heading: "해제", lines: uninstall });
  }
  return blocks;
}

/** What a copy affordance puts on the clipboard: the block as it would be typed. */
export function blockText(block: CommandBlock): string {
  return block.lines.join("\n");
}
