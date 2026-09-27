import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { browserBoardsCollected, visibleBrowseModes } from "@/lib/navigation/edition";

function root(marker?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "edition-"));
  if (marker !== undefined) writeFileSync(join(dir, ".taste-inbox-community"), marker);
  return dir;
}

const ids = (dir: string) => visibleBrowseModes(dir).map((mode) => mode.id);

describe("which Browse modes the rail offers", () => {
  it("offers all six where there is no marker — the personal workspace", () => {
    expect(ids(root())).toEqual(["all", "trends", "style", "music", "places", "none"]);
  });

  it("offers All · Trends · None in a tree that runs no browser collector", () => {
    const dir = root(
      JSON.stringify({ edition: "rnd", browserAutomation: false, apiCollection: true }),
    );
    expect(browserBoardsCollected(dir)).toBe(false);
    expect(ids(dir)).toEqual(["all", "trends", "none"]);
  });

  it("keeps all six when the marker allows browser collection", () => {
    expect(ids(root(JSON.stringify({ browserAutomation: true })))).toHaveLength(6);
  });

  it("does not hide anything on a marker it cannot read", () => {
    expect(ids(root("{not json"))).toHaveLength(6);
  });

  it("reads this repository's own marker as the rnd edition", () => {
    expect(ids(join(process.cwd(), "..", ".."))).toEqual(["all", "trends", "none"]);
  });
});
