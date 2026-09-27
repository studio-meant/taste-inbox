import "@testing-library/jest-dom/vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/*
 * The rail hides the browser-only boards when the tree's `.taste-inbox-community` marker
 * says no browser collector runs (`lib/navigation/edition.ts`). The suite tests the rail,
 * not the edition, so it reads a root with no marker — the personal workspace, all six
 * modes. `tests/edition.test.ts` covers the marker itself.
 */
process.env.TASTE_INBOX_REPO_ROOT = join(tmpdir(), "taste-inbox-tests-no-marker");

afterEach(() => {
  cleanup();
});
