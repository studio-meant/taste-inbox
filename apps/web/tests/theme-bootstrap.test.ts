import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from "@taste-inbox/ui/theme";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION_MODE,
  MOTION_STORAGE_KEY,
  buildThemeBootstrapScript,
} from "@/components/theme/theme-bootstrap";

/**
 * The bootstrap is an inline `<script>` that runs before hydration, so it is a built
 * string rather than a component. These tests execute the exact emitted source.
 *
 * Storage is injected instead of taken from the environment: Vitest's jsdom setup does
 * not expose `localStorage` as a global, and injecting it also lets a failing store be
 * simulated directly.
 */

interface StorageLike {
  getItem(key: string): string | null;
}

function memoryStorage(entries: Record<string, string> = {}): StorageLike {
  return {
    getItem: (key) => entries[key] ?? null,
  };
}

const failingStorage: StorageLike = {
  getItem() {
    throw new Error("storage disabled");
  },
};

function runBootstrap(storage: StorageLike): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("localStorage", "document", buildThemeBootstrapScript()) as (
    storage: StorageLike,
    doc: Document,
  ) => void;
  run(storage, document);
}

describe("theme bootstrap", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.motion;
  });

  it("applies the product default when nothing is stored", () => {
    runBootstrap(memoryStorage());
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
    expect(document.documentElement.dataset.motion).toBe(DEFAULT_MOTION_MODE);
  });

  it("restores a saved theme", () => {
    runBootstrap(memoryStorage({ [THEME_STORAGE_KEY]: "spring-sage" }));
    expect(document.documentElement.dataset.theme).toBe("spring-sage");
  });

  it("restores a saved motion mode", () => {
    runBootstrap(memoryStorage({ [MOTION_STORAGE_KEY]: "reduced" }));
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("falls back to the default for a theme this version no longer ships", () => {
    // The v3 storage key exists precisely so an older prototype's value cannot win.
    runBootstrap(memoryStorage({ [THEME_STORAGE_KEY]: "theme-from-an-older-prototype" }));
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME_ID);
  });

  it("falls back to the default for an unknown motion mode", () => {
    runBootstrap(memoryStorage({ [MOTION_STORAGE_KEY]: "wild" }));
    expect(document.documentElement.dataset.motion).toBe(DEFAULT_MOTION_MODE);
  });

  it.each(["cinematic", "ambient", "reduced"])("accepts the %s motion mode", (mode) => {
    runBootstrap(memoryStorage({ [MOTION_STORAGE_KEY]: mode }));
    expect(document.documentElement.dataset.motion).toBe(mode);
  });

  it("defaults to cinematic, not ambient", () => {
    // DESIGN.md §14 forbids ambient loops on screens holding content; `ambient` is an
    // opt-in comparison mode, never the shipped default.
    expect(DEFAULT_MOTION_MODE).toBe("cinematic");
  });

  it("accepts every registered theme", () => {
    for (const id of THEME_IDS) {
      runBootstrap(memoryStorage({ [THEME_STORAGE_KEY]: id }));
      expect(document.documentElement.dataset.theme, id).toBe(id);
    }
  });

  it("never throws when storage is unavailable", () => {
    // A blocked or full store must not stop the app from rendering.
    expect(() => {
      runBootstrap(failingStorage);
    }).not.toThrow();
  });

  it("reads only appearance preference", () => {
    // Frontend architecture §3: local storage holds non-sensitive appearance only.
    const script = buildThemeBootstrapScript();
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain(MOTION_STORAGE_KEY);
    expect(script).not.toMatch(/token|cookie|secret|password/i);
  });

  it("embeds the theme allowlist rather than trusting stored input", () => {
    const script = buildThemeBootstrapScript();
    for (const id of THEME_IDS) {
      expect(script).toContain(id);
    }
  });
});
