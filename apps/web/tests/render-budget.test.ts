import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the always-on layout is allowed to fetch.
 *
 * The workspace layout runs on every navigation inside the group, so anything it asks for
 * is paid for by pages that display none of it. It listed all three boards to render three
 * integers in the mode strip: /library paid 4 requests and ~175 KB while containing zero
 * `repository.` references of its own, and /today pulled 176 KiB of board JSON and 653 SQL
 * statements without rendering a single board card. `getBoardCounts()` answers the same
 * question in one request, 69 bytes and 3 statements.
 *
 * A grep over the source rather than a render assertion, following
 * `repository-boundary.test.ts`: the cost is in the call being present at all, and a
 * rendered tree cannot tell you that. The reason travels with the check so the next person
 * adding "just one board" here reads why it was removed.
 */

// Resolved from this file, not from `process.cwd()`: the suite runs with the workspace
// root as cwd under `pnpm test` and with `apps/web` under a filtered run.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const WORKSPACE_LAYOUT = join(SRC, "app", "(workspace)", "layout.tsx");

const LAYOUT_SOURCE = readFileSync(WORKSPACE_LAYOUT, "utf8");

const BOARD_LISTS = /listAIItems|listStyleItems|listMusicItems/g;

describe("workspace layout render budget", () => {
  it("lists no board to render the mode-strip counts", () => {
    expect(LAYOUT_SOURCE.match(BOARD_LISTS)).toBeNull();
  });

  it("still gets its counts, so the strip is not just empty", () => {
    // Guards the opposite failure: deleting the call rather than replacing it would also
    // satisfy the check above.
    expect(LAYOUT_SOURCE).toContain("getBoardCounts()");
  });

  it("reads the layout it claims to, so a passing result means something", () => {
    // Guards against the file being moved and the check quietly asserting about "".
    expect(LAYOUT_SOURCE).toContain("export default async function WorkspaceLayout");
  });
});
