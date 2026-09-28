import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_THEME_ID, THEMES, THEME_STORAGE_KEY } from "@taste-inbox/ui/theme";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SETTING_FIELDS, SETTINGS_SECTIONS } from "@/components/settings/fields";
import { buildThemeBootstrapScript } from "@/components/theme/theme-bootstrap";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { readSource, sourcePath } from "./source-files";

/**
 * The theme picker — the first control in the product that changes the applied theme.
 *
 * The list is checked against `packages/ui/theme-ids.json` read from disk rather than
 * against `THEMES`: the identity file is the source both `packages/ui` and `apps/api`
 * resolve from, so comparing the rendered ids to it catches a registry that stopped
 * agreeing with it. A literal list of six ids here would only pin this test to itself.
 */
const themeIdentity = JSON.parse(
  readFileSync(resolve(sourcePath(), "..", "..", "..", "packages", "ui", "theme-ids.json"), "utf8"),
) as { readonly themeIds: readonly string[]; readonly defaultThemeId: string };

/** A theme that is not the default, so "it changed" and "it was already that" differ. */
const OTHER = THEMES.find((theme) => theme.id !== DEFAULT_THEME_ID);

function cardName(name: string): RegExp {
  // Anchored: one theme's note names another theme ("Meadow Cream보다 …"), so an
  // unanchored match would find two radios.
  return new RegExp(`^${name}`);
}

/**
 * A working `window.localStorage`.
 *
 * Vitest's jsdom environment lists `localStorage` on `window` but the property reads back
 * as `undefined` (Node's own experimental global shadows it), which is the same reason
 * `theme-bootstrap.test.ts` injects its storage rather than taking the environment's.
 * Installed per test so one test's choice cannot be another's starting state.
 */
function installMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => {
      entries.clear();
    },
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  return storage;
}

async function openPicker(): Promise<{
  user: ReturnType<typeof userEvent.setup>;
  dialog: HTMLElement;
}> {
  const user = userEvent.setup();
  render(<ThemePicker />);
  await user.click(screen.getByRole("button", { name: "테마 바꾸기" }));
  return { user, dialog: screen.getByRole("dialog") };
}

describe("ThemePicker", () => {
  beforeEach(() => {
    installMemoryStorage();
    delete document.documentElement.dataset.theme;
  });

  it("offers exactly the themes named in theme-ids.json", async () => {
    const { dialog } = await openPicker();
    const rendered = within(dialog)
      .getAllByRole("radio")
      .map((radio) => (radio as HTMLInputElement).value);

    expect(rendered).toEqual(themeIdentity.themeIds);
  });

  it("applies a chosen theme to the document and remembers it", async () => {
    expect(OTHER).toBeDefined();
    const { user } = await openPicker();

    await user.click(screen.getByRole("radio", { name: cardName(OTHER!.name) }));

    expect(document.documentElement.dataset.theme).toBe(OTHER!.id);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(OTHER!.id);
  });

  it("marks the applied theme as current, and only that one", async () => {
    const { user } = await openPicker();

    // Nothing stored yet: the bootstrap's fallback is what the picker reports.
    const defaultTheme = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    expect(screen.getByRole("radio", { name: cardName(defaultTheme!.name) })).toBeChecked();
    // Non-colour signal, DESIGN.md §18: the chosen card says so in words.
    expect(screen.getAllByText("사용 중")).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: cardName(OTHER!.name) }));

    expect(screen.getByRole("radio", { name: cardName(OTHER!.name) })).toBeChecked();
    expect(screen.getByRole("radio", { name: cardName(defaultTheme!.name) })).not.toBeChecked();
    expect(screen.getAllByText("사용 중")).toHaveLength(1);
  });

  it("changes the theme without navigating or dropping the query state", async () => {
    // CLAUDE.md §6 — a theme change preserves the current screen and query state. The
    // picker owns no router and no link, so the only way it could navigate is a URL write.
    window.history.replaceState(null, "", "/system?board=ai&sort=recent");
    const before = window.location.href;
    const { user, dialog } = await openPicker();

    await user.click(screen.getByRole("radio", { name: cardName(OTHER!.name) }));

    expect(window.location.href).toBe(before);
    // Still open and still on screen: the choice is applied in place, not committed.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).queryAllByRole("link")).toHaveLength(0);
  });

  it("survives a reload through the bootstrap, with no flash of the default", async () => {
    const { user } = await openPicker();
    await user.click(screen.getByRole("radio", { name: cardName(OTHER!.name) }));

    // A fresh document: only what the picker persisted is left.
    delete document.documentElement.dataset.theme;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function("localStorage", "document", buildThemeBootstrapScript()) as (
      storage: Storage,
      doc: Document,
    ) => void;
    run(window.localStorage, document);

    expect(document.documentElement.dataset.theme).toBe(OTHER!.id);
  });

  it("moves focus into the drawer, onto the current choice", async () => {
    const { dialog } = await openPicker();
    expect(within(dialog).getByRole("radio", { checked: true })).toHaveFocus();
  });

  it("closes on Escape and gives focus back to the trigger", async () => {
    const { user } = await openPicker();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "테마 바꾸기" })).toHaveFocus();
  });

  it("closes from the close button, by keyboard", async () => {
    const { user } = await openPicker();

    const close = screen.getByRole("button", { name: "닫기" });
    close.focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "테마 바꾸기" })).toHaveFocus();
  });

  it("offers the dismiss surface as a named control rather than a bare overlay", async () => {
    await openPicker();
    expect(screen.getByRole("button", { name: "테마 목록 닫기" })).toBeInTheDocument();
  });

  it("keeps Tab inside the drawer", async () => {
    const { user, dialog } = await openPicker();

    // Walk past the end of the list; focus has to wrap rather than land on the page.
    const visited = new Set<Element>();
    for (let step = 0; step < 12; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
      if (document.activeElement !== null) {
        visited.add(document.activeElement);
      }
    }
    // …and it has to have moved at all, or the assertion above proves nothing.
    expect(visited.size).toBeGreaterThan(1);
  });
});

describe("theme picker styling", () => {
  const files = ["ThemePicker.module.css", "ThemeCardPreview.module.css"] as const;

  it.each(files)("%s declares no colour of its own", (file) => {
    // DESIGN.md §20 — no raw hex outside `packages/ui`.
    const css = readSource("components", "theme", file);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("lets the drawer's motion be opted out of, both ways", () => {
    // The OS preference and the product's own Reduced mode (DESIGN.md §18, CLAUDE.md §6).
    const css = readSource("components", "theme", "ThemePicker.module.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain(':global(:root[data-motion="reduced"])');
  });
});

describe("settings copy about the theme", () => {
  const field = SETTING_FIELDS.find((candidate) => candidate.key === "appearance.defaultTheme");
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === "appearance");

  it("no longer says changing the theme does nothing", () => {
    expect(field).toBeDefined();
    // The row is still fixed — nothing reads the file value — but it may not imply that
    // the applied theme is unchangeable, because it is not.
    expect(field!.fixedReason).not.toMatch(/색이 달라지지 않/);
    expect(field!.fixedReason).not.toMatch(/읽는 코드는 아직 없어요\.$/);
  });

  it("names the place that does change the theme", () => {
    // System is part of Settings since 2026-09-28, so the picker is the '테마' block below.
    expect(field!.fixedReason).toContain("아래 '테마'");
    expect(section!.description).toContain("아래 '테마'");
  });
});
