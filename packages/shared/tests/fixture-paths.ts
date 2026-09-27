import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository-root fixture tree, shared with `apps/api`. See data/fixtures/README.md. */
export const FIXTURES_ROOT = fileURLToPath(new URL("../../../data/fixtures/", import.meta.url));

export function fixtureDir(...segments: string[]): string {
  return join(FIXTURES_ROOT, ...segments);
}

export function readJsonFixtures(...segments: string[]): { name: string; value: unknown }[] {
  const dir = fixtureDir(...segments);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      value: JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown,
    }));
}
