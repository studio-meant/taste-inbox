import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Nothing outside `lib/mock/` may reach into it.
 *
 * `getRepository()` is the one place that decides where data comes from, and that is only
 * true while every page and component goes through it. This is enforced here rather than
 * by convention because the last violation was invisible: three board pages imported
 * `loadCollected` directly, so `NEXT_PUBLIC_DATA_SOURCE=live` would not have failed
 * cleanly — it would have served API items with badges read from local files, which is
 * the worst of both.
 *
 * A grep test rather than a lint rule so the reason travels with the check.
 */

// Resolved from this file, not from `process.cwd()`: the suite runs with the workspace
// root as cwd under `pnpm test` and with `apps/web` under a filtered run, and a check
// that passes in one and fails in the other teaches everyone to ignore it.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const MOCK_DIR = join(SRC, "lib", "mock");

/** Every `.ts`/`.tsx` file under `src/`, excluding the mock module itself. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (path !== MOCK_DIR) {
        found.push(...sourceFiles(path));
      }
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

const OFFENDERS = sourceFiles(SRC)
  .filter((path) => path !== join(SRC, "lib", "repository", "index.ts"))
  .map((path) => ({ path, text: readFileSync(path, "utf8") }))
  .filter(
    ({ text }) => /from\s+["']@\/lib\/mock/.test(text) || /from\s+["'][./]+lib\/mock/.test(text),
  );

describe("repository boundary", () => {
  it("is crossed by exactly one file", () => {
    // `lib/repository/index.ts` constructs MockRepository; nothing else may know it exists.
    expect(OFFENDERS.map((file) => file.path.replace(SRC, "src"))).toEqual([]);
  });

  it("keeps the mock module out of every page", () => {
    const pages = sourceFiles(join(SRC, "app"));
    for (const path of pages) {
      expect(readFileSync(path, "utf8")).not.toContain("@/lib/mock");
    }
  });

  it("keeps the mock module out of every component", () => {
    const components = sourceFiles(join(SRC, "components"));
    for (const path of components) {
      expect(readFileSync(path, "utf8")).not.toContain("@/lib/mock");
    }
  });

  it("finds files to check, so a passing result means something", () => {
    // Guards against the check silently passing because the walk returned nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });
});
