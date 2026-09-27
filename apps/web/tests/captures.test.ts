import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasCollected, loadCollected, resetCaptureCache } from "@/lib/mock/captures";

/**
 * The capture loader reads the user's own saved posts out of the gitignored `var/` tree.
 *
 * Every test here writes into a temporary directory and points the loader at it. Reading
 * the real `var/captures/` would make the suite depend on one machine's collections, and
 * writing there would destroy data that took a live browser session to gather.
 */

let dir: string;

const ITEM = {
  code: "DAaaaaaaaaa",
  media_type: "video",
  product_type: "clips",
  taken_at: 1757736341,
  owner: "someone",
  caption: "노래 추천",
  accessibility_caption: null,
  audio_title: null,
  audio_artist: null,
  is_original_audio: true,
  product_tag_count: 0,
  user_tag_count: 0,
  source_endpoint: "/api/v1/feed/",
  thumbnail_url: "https://scontent.cdninstagram.com/v/t51/thumb.jpg",
  thumbnail_width: 640,
  thumbnail_height: 800,
};

function write(domain: string, body: unknown): void {
  writeFileSync(join(dir, `saved-${domain}.json`), JSON.stringify(body), "utf8");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "taste-inbox-captures-"));
  vi.stubEnv("TASTE_INBOX_CAPTURE_DIR", dir);
  vi.stubEnv("TASTE_INBOX_USE_CAPTURES", "1");
  resetCaptureCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetCaptureCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("loadCollected", () => {
  it("reads a well-formed capture file", () => {
    write("music", [ITEM]);
    const items = loadCollected("music");
    expect(items).toHaveLength(1);
    expect(items[0]?.code).toBe("DAaaaaaaaaa");
  });

  it("returns nothing when the file is absent, rather than throwing", () => {
    // The default state of a fresh checkout. The app must still start.
    expect(loadCollected("fashion")).toEqual([]);
  });

  it("keeps ad items", () => {
    // Deliberately saved by the user, so filtering them would drop real signal
    // (docs/DECISIONS.md, 2026-08-08).
    write("fashion", [{ ...ITEM, product_type: "ad" }]);
    expect(loadCollected("fashion")).toHaveLength(1);
  });

  it("keeps both posts and reels", () => {
    write("ai", [ITEM, { ...ITEM, code: "OTHER12345", product_type: "feed", media_type: "image" }]);
    expect(loadCollected("ai")).toHaveLength(2);
  });

  it("falls back to empty on a schema mismatch instead of taking the page down", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    write("music", [{ code: "DAaaaaaaaaa" }]);
    expect(loadCollected("music")).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to empty on malformed JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writeFileSync(join(dir, "saved-ai.json"), "{ not json", "utf8");
    expect(loadCollected("ai")).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("caches so a board rendering many cards reads the file once", () => {
    write("music", [ITEM]);
    expect(loadCollected("music")).toBe(loadCollected("music"));
  });
});

describe("hasCollected", () => {
  it("distinguishes a real collection from an absent one", () => {
    write("music", [ITEM]);
    expect(hasCollected("music")).toBe(true);
    expect(hasCollected("fashion")).toBe(false);
  });

  it("reports false for an empty collection, so the board does not claim it was collected", () => {
    write("fashion", []);
    expect(hasCollected("fashion")).toBe(false);
  });
});

describe("capture reads under test", () => {
  it("is off by default, so the suite never depends on local data", () => {
    vi.stubEnv("TASTE_INBOX_USE_CAPTURES", undefined);
    write("music", [ITEM]);
    resetCaptureCache();
    expect(loadCollected("music")).toEqual([]);
  });
});
