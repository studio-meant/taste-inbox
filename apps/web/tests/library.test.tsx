import type { AIItemCardModel, MusicItemCardModel, StyleItemCardModel } from "@taste-inbox/shared";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import LibraryPage from "@/app/(workspace)/library/page";
import { leadIndex, mergeBoards } from "@/lib/collection/merged-board";
import { MockRepository } from "@/lib/mock/repository";

/**
 * Browse > All — every board in one list.
 *
 * The route carried an empty state for a while, on the reasoning that a merged board needs
 * one card grammar for an AI post, a fashion carousel and a Reel with five candidate songs.
 * These tests hold the answer that replaced it: **several grammars, one order.** Each item
 * keeps its own board's card, and what the merged board owns is the sequence and the room.
 *
 * `ScrollRestore` is the only client component here that needs the App Router — the rest of
 * the tree is either a Server Component or a client one that reads nothing from context.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));

/** The page is an async Server Component: awaiting it yields the element to render. */
async function renderLibrary(params: Record<string, string> = {}) {
  return render(await LibraryPage({ searchParams: Promise.resolve(params) }));
}

/**
 * Every card's item id, in the order the board actually put them on screen.
 *
 * Read off the title links rather than off any card-specific markup: all three cards link
 * their heading to `/items/<id>`, which is the one thing they have in common and the thing
 * a reader follows.
 */
function boardOrder(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('a[href^="/items/"]')].map((link) =>
    new URL(link.getAttribute("href") ?? "", "https://taste-inbox.local").pathname.replace(
      "/items/",
      "",
    ),
  );
}

const SOURCE = {
  platform: "instagram",
  label: "Instagram Saved",
  originalUrl: "https://www.instagram.com/reel/AAA/",
  author: "someone",
  actionType: "save",
  firstSeenAt: "2026-08-08T00:00:00.000Z",
} as const;

function ai(id: string, firstSeenAt: string): AIItemCardModel {
  return { id, source: { ...SOURCE, firstSeenAt } } as unknown as AIItemCardModel;
}
function style(id: string, firstSeenAt: string): StyleItemCardModel {
  return { id, source: { ...SOURCE, firstSeenAt } } as unknown as StyleItemCardModel;
}
function music(id: string, firstSeenAt: string): MusicItemCardModel {
  return { id, source: { ...SOURCE, firstSeenAt } } as unknown as MusicItemCardModel;
}
/* Places carries `AIItemCardModel`, so this is `ai()` under the name of the other board
   that uses it — a second builder would only let the two drift apart. */
function place(id: string, firstSeenAt: string): AIItemCardModel {
  return ai(id, firstSeenAt);
}

describe("mergeBoards", () => {
  it("orders newest first across every board, never board by board", () => {
    // The whole point of merging. Grouped by board it would be three lists stacked, which
    // is what the rail already offers and what this route existed to stop being.
    const merged = mergeBoards({
      ai: [ai("a-old", "2026-08-01T00:00:00Z"), ai("a-new", "2026-08-09T00:00:00Z")],
      style: [style("s-mid", "2026-08-05T00:00:00Z")],
      music: [music("m-newest", "2026-08-10T00:00:00Z")],
      places: [],
    });

    expect(merged.map((entry) => entry.item.id)).toEqual(["m-newest", "a-new", "s-mid", "a-old"]);
  });

  it("breaks a tie by id even when neither timestamp can be parsed", () => {
    /*
     * The subtraction form could not. Both unparseable values read as `NEGATIVE_INFINITY`,
     * and `-Infinity - -Infinity` is `NaN` — not `0`, so the comparator returned before the
     * id tiebreak ran, and the spec coerces a `NaN` result to `+0`. The order fell back to
     * input order, which is exactly what the tie-break exists to prevent.
     *
     * The test above cannot see it: its timestamps parse, so the `NaN` branch never runs.
     */
    const bad = "not a timestamp";
    const forward = mergeBoards({
      ai: [ai("z", bad), ai("a", bad)],
      style: [],
      music: [],
      places: [],
    });
    const reversed = mergeBoards({
      ai: [ai("a", bad), ai("z", bad)],
      style: [],
      music: [],
      places: [],
    });

    expect(forward.map((entry) => entry.item.id)).toEqual(["a", "z"]);
    expect(forward.map((entry) => entry.item.id)).toEqual(reversed.map((entry) => entry.item.id));
  });

  it("breaks a tie by id, so a reload never reshuffles the board", () => {
    // A collector run stamps a page of items within the same second, so ties are the normal
    // case rather than an edge one. Without a second key the order among them is whatever
    // the input order happened to be — which differs between a filtered and an unfiltered
    // fetch, and between the server render and hydration.
    const same = "2026-08-08T00:00:00Z";
    const forward = mergeBoards({
      ai: [ai("b", same), ai("a", same)],
      style: [style("c", same)],
      music: [],
      places: [],
    });
    const reversed = mergeBoards({
      ai: [ai("a", same), ai("b", same)],
      style: [style("c", same)],
      music: [],
      places: [],
    });

    expect(forward.map((entry) => entry.item.id)).toEqual(["a", "b", "c"]);
    expect(reversed.map((entry) => entry.item.id)).toEqual(forward.map((entry) => entry.item.id));
  });

  it("keeps a card's own board with it, so the page can pick the right card", () => {
    const merged = mergeBoards({
      ai: [ai("a", "2026-08-03T00:00:00Z")],
      style: [style("s", "2026-08-02T00:00:00Z")],
      music: [music("m", "2026-08-01T00:00:00Z")],
      places: [place("p", "2026-08-04T00:00:00Z")],
      none: [ai("n", "2026-08-05T00:00:00Z")],
    });
    expect(merged.map((entry) => entry.board)).toEqual([
      "none",
      "places",
      "trends",
      "style",
      "music",
    ]);
  });

  it("keeps places apart from trends even though the two share a card model", () => {
    // The tag is the whole reason the entry is a discriminated union rather than a bare
    // model: two boards using `AIItemCardModel` are still two boards, and an item that
    // arrived on Places must not be labelled Trends by the merge.
    const merged = mergeBoards({
      ai: [ai("a", "2026-08-03T00:00:00Z")],
      style: [],
      music: [],
      places: [place("p", "2026-08-02T00:00:00Z")],
    });
    expect(merged.map((entry) => [entry.board, entry.item.id])).toEqual([
      ["trends", "a"],
      ["places", "p"],
    ]);
  });

  it("puts an item whose timestamp cannot be read last rather than dropping the board", () => {
    const merged = mergeBoards({
      ai: [ai("broken", "not a date"), ai("fine", "2026-08-01T00:00:00Z")],
      style: [],
      music: [],
      places: [],
    });
    expect(merged.map((entry) => entry.item.id)).toEqual(["fine", "broken"]);
  });
});

describe("leadIndex", () => {
  it("leads with the newest item that is not music", () => {
    // `browseCardSize` turns index 0 into a two-column `wide` card. A Music sleeve keeps a
    // fixed square shape, so the Browse-card lead must come from one of the other boards.
    const merged = mergeBoards({
      ai: [ai("a", "2026-08-08T00:00:00Z")],
      style: [],
      music: [music("m", "2026-08-09T00:00:00Z")],
      places: [],
    });
    expect(merged[0]?.board).toBe("music");
    expect(leadIndex(merged)).toBe(1);
  });

  it("has no separate Browse-card lead when every item is music", () => {
    // The square sleeves already share one visual grammar, and -1 matches no index.
    expect(
      leadIndex(
        mergeBoards({ ai: [], style: [], music: [music("m", SOURCE.firstSeenAt)], places: [] }),
      ),
    ).toBe(-1);
  });
});

describe("the merged board", () => {
  it("offers direct link input locally but not on the remote read-only view", async () => {
    expect(screen.queryByRole("button", { name: "링크 추가" })).not.toBeInTheDocument();
    const local = await renderLibrary();
    expect(screen.getByRole("button", { name: "링크 추가" })).toBeInTheDocument();
    local.unmount();

    vi.stubEnv("NEXT_PUBLIC_REMOTE_READ_ONLY", "1");
    try {
      await renderLibrary();
      expect(screen.queryByRole("button", { name: "링크 추가" })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("shows every kind of item at once", async () => {
    // The claim the route used to say it could not make.
    const { container } = await renderLibrary();

    /*
     * Scoped to the grid, not the page. `getAllByText("Style")` matched `CollectionRail`'s
     * "Browse by type" links, which render on every board whatever is on it — so both
     * assertions passed with zero Style and zero Music cards, i.e. they were true of the
     * shell rather than of the claim they are named after.
     */
    const board = container.querySelector("ul[class*='board']");
    expect(board).not.toBeNull();
    const grid = within(board as HTMLElement);

    expect(grid.getAllByText("Style").length).toBeGreaterThan(0);
    expect(grid.getAllByText("Music").length).toBeGreaterThan(0);
    // AIItemCard's eyebrow is the item's kind — 저장소 for a repository, 게시물 for a post.
    expect(grid.getAllByText(/저장소|게시물/).length).toBeGreaterThan(0);

    const repository = new MockRepository();
    const [aiPage, stylePage, musicPage, placesPage, nonePage] = await Promise.all([
      repository.listAIItems({ limit: 200 }),
      repository.listStyleItems({ limit: 200 }),
      repository.listMusicItems({ limit: 200 }),
      repository.listPlacesItems({ limit: 200 }),
      repository.listDeclinedItems({ limit: 200 }),
    ]);
    expect(boardOrder(container)).toHaveLength(
      aiPage.items.length +
        stylePage.items.length +
        musicPage.items.length +
        placesPage.items.length +
        nonePage.items.length,
    );
  });

  it("includes the no-board inbox in All instead of hiding a collected item", async () => {
    const repository = new MockRepository();
    const target = (await repository.listAIItems({ limit: 200 })).items[0];
    expect(target).toBeDefined();
    await repository.setItemBoard(target!.id, "none");
    const repositoryModule = await import("@/lib/repository");
    const getRepository = vi.spyOn(repositoryModule, "getRepository").mockReturnValue(repository);

    try {
      const { container } = await renderLibrary();
      expect(boardOrder(container)).toContain(target!.id);
      const card = container.querySelector(`a[href^="/items/${target!.id}?"]`)?.closest("li");
      expect(card?.className).toContain("libraryNone");
    } finally {
      getRepository.mockRestore();
    }
  });

  it("passes Today's day filter to the no-board inbox too", async () => {
    const repository = new MockRepository();
    const none = vi.spyOn(repository, "listDeclinedItems");
    const repositoryModule = await import("@/lib/repository");
    const getRepository = vi.spyOn(repositoryModule, "getRepository").mockReturnValue(repository);

    try {
      await renderLibrary({ day: "2026-08-08" });
      expect(none).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-08-08" }));
    } finally {
      getRepository.mockRestore();
    }
  });

  it("interleaves the boards by date rather than stacking them", async () => {
    const repository = new MockRepository();
    const [aiPage, stylePage, musicPage, placesPage] = await Promise.all([
      repository.listAIItems({ limit: 200 }),
      repository.listStyleItems({ limit: 200 }),
      repository.listMusicItems({ limit: 200 }),
      repository.listPlacesItems({ limit: 200 }),
    ]);
    const expected = mergeBoards({
      ai: aiPage.items,
      style: stylePage.items,
      music: musicPage.items,
      places: placesPage.items,
    });

    const { container } = await renderLibrary();
    expect(boardOrder(container)).toEqual(expected.map((entry) => entry.item.id));

    // And it is genuinely mixed: a board rendered board-by-board would give three runs.
    const boards = expected.map((entry) => entry.board);
    const runs = boards.filter((board, index) => board !== boards[index - 1]);
    expect(runs.length).toBeGreaterThan(3);
  });

  it("applies ?source= to all three lists, not to the ones that happen to offer it", async () => {
    /*
     * docs/DECISIONS.md (2026-08-08): a filter that is parsed must be applied. A board
     * answering `?source=github` with Instagram Reels contradicts the link it came from,
     * and that is worse than not offering the filter at all — so this asserts what is
     * *absent* as well as what survived.
     */
    const { container } = await renderLibrary({ source: "github" });
    const ids = boardOrder(container);

    const repository = new MockRepository();
    const expected = await repository.listAIItems({ limit: 200, source: ["github"] });

    expect(ids.length).toBeGreaterThan(0);
    expect([...ids].sort()).toEqual([...expected.items.map((item) => item.id)].sort());

    /*
     * Nothing from the other two boards rode along — asserted on the cards rather than on
     * the page text, because the rail legitimately says "Style" and "Music" as the names of
     * two boards one click away.
     *
     * The board picker is excluded from the text for the same reason the rail is: its five
     * options are the names of the five places an item can go, on every card whatever board
     * the card is on. What is being asserted is the card's *content*, so the control that
     * would move it elsewhere is not part of it.
     */
    const cards = [...container.querySelectorAll("article")];
    expect(cards).toHaveLength(expected.items.length);
    expect(container.querySelector('[id^="music-"]')).toBeNull();
    for (const card of cards) {
      const content = card.cloneNode(true) as HTMLElement;
      content.querySelectorAll("select").forEach((control) => {
        control.remove();
      });
      expect(content.textContent).not.toContain("Style");
    }
  });

  it("says so rather than showing an unfiltered board when a filter matches nothing", async () => {
    // `?source=web` is a real value in the schema with no items behind it — the difference
    // between "you have nothing saved" and "this filter has nothing" is a real one.
    await renderLibrary({ source: "web" });
    expect(screen.getByText("이 조건에 맞는 항목이 없어요")).toBeInTheDocument();
    expect(screen.queryByText("아직 저장한 항목이 없어요")).not.toBeInTheDocument();
  });

  it("uses the same square Music shelf card as the dedicated Music tab", async () => {
    const { container } = await renderLibrary();
    const musicHeading = container.querySelector('[id^="music-shelf-"]');
    expect(musicHeading).not.toBeNull();

    const card = musicHeading?.closest("article");
    expect(card?.className).toContain("shelfCard");
    expect(musicHeading?.closest("li")?.className).toContain("libraryMusic");
  });

  it("declares the mixed Music tile as a square aligned to two row units", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const boardCss = readFileSync(
      join(here, "..", "src", "components", "collection", "Board.module.css"),
      "utf8",
    );
    const browseCss = readFileSync(
      join(here, "..", "src", "components", "collection", "BrowseCard.module.css"),
      "utf8",
    );
    const musicCss = readFileSync(
      join(here, "..", "src", "components", "music", "MusicItemCard.module.css"),
      "utf8",
    );
    expect(boardCss).toMatch(/\.libraryMusic\s*\{[^}]*grid-row:\s*span\s+2/);
    expect(musicCss).toMatch(/\.shelfCard\s*\{[^}]*aspect-ratio:\s*1/);
    expect(browseCss).not.toContain(".spanFull");
  });

  it("gives every All category its own themed surface", async () => {
    const { container } = await renderLibrary();
    const board = container.querySelector("ul[class*='board']");
    const itemClasses = [...(board?.children ?? [])].map((item) => item.className);

    expect(itemClasses.some((value) => value.includes("libraryTrends"))).toBe(true);
    expect(itemClasses.some((value) => value.includes("libraryStyle"))).toBe(true);
    expect(itemClasses.some((value) => value.includes("libraryMusic"))).toBe(true);

    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(
      join(here, "..", "src", "components", "collection", "Board.module.css"),
      "utf8",
    );
    for (const category of ["Trends", "Style", "Music", "Places", "None"]) {
      expect(css).toMatch(new RegExp(`\\.library${category}\\s*\\{[^}]*--library-card-bg:`));
    }
  });

  it("leads with the newest item that is not a fixed-square Music sleeve", async () => {
    const { container } = await renderLibrary();

    const repository = new MockRepository();
    const [aiPage, stylePage, musicPage, placesPage] = await Promise.all([
      repository.listAIItems({ limit: 200 }),
      repository.listStyleItems({ limit: 200 }),
      repository.listMusicItems({ limit: 200 }),
      repository.listPlacesItems({ limit: 200 }),
    ]);
    const merged = mergeBoards({
      ai: aiPage.items,
      style: stylePage.items,
      music: musicPage.items,
      places: placesPage.items,
    });
    const lead = leadIndex(merged);

    /*
     * `leadIndex` is asserted, not the `wide` class it feeds.
     *
     * An earlier version pinned "exactly one `.spanWide` card" and called the seed's shape
     * "the real case rather than a contrived one". It is not: on the collected board there
     * are **zero** wide cards, because `browseCardSize` returns `small` at
     * `mediaCount === 0` before it ever reaches the `index === 0` rule, and the newest
     * non-music item there is a GitHub star with no preview. That early return is
     * pre-existing and `/trends` has the same zero — so a test that demanded a wide card
     * was describing the fixture, not the product.
     *
     * What this rule actually owes is the thing `leadIndex` decides: the lead is never a
     * Music sleeve, because a fixed square cannot also take the Browse-card wide shape.
     */
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(merged[lead]?.board).not.toBe("music");
    expect(merged.slice(0, lead).every((entry) => entry.board === "music")).toBe(true);

    const musicTiles = container.querySelectorAll('[id^="music-shelf-"]');
    expect(musicTiles.length).toBeGreaterThan(0);
  });

  it("counts on the header what it actually rendered", async () => {
    // The number over the board and the number of cards under it are one claim. They can
    // drift: `getBoardCounts()` counts music without the `handled` filter this page applies
    // (`repository/types.ts`), so the header is computed from the merged page instead.
    const { container } = await renderLibrary();
    const rendered = boardOrder(container).length;

    const meta = screen.getByRole("list", { name: "보드 상태" });
    expect(within(meta).getByText(`${rendered.toLocaleString("ko-KR")}개`)).toBeInTheDocument();
  });

  it("counts the filtered board, not the whole collection", async () => {
    const { container } = await renderLibrary({ source: "github" });
    const rendered = boardOrder(container).length;

    const meta = screen.getByRole("list", { name: "보드 상태" });
    expect(within(meta).getByText(`${rendered.toLocaleString("ko-KR")}개`)).toBeInTheDocument();
  });

  it("offers the sources of the merged board, as one single-select group", async () => {
    // `?source=` on this board reaches three lists, so the rail counts all three — and the
    // rows replace rather than accumulate, as of the rail's single-select change.
    await renderLibrary();
    const rail = screen.getByRole("navigation", { name: "Inbox 필터" });

    const github = within(rail).getByRole("link", { name: /GitHub/ });
    expect(github).toHaveAttribute("href", "/library?source=github");
  });

  it("no longer claims the merged view is unbuilt", async () => {
    // The empty state and the header note both said so. Leaving either behind would be a
    // documented limitation that is no longer true.
    const { container } = await renderLibrary();
    expect(container.textContent).not.toContain("준비 중");
    expect(container.textContent).not.toContain("합쳐 보는 화면");
    expect(screen.queryByText(/보드별로 나눠 보고 있어요/)).not.toBeInTheDocument();
  });

  it("keeps that copy out of the route's source as well", () => {
    // The rendered assertion above only covers the states this fixture reaches.
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "..", "src", "app", "(workspace)", "library", "page.tsx"),
      "utf8",
    );
    expect(source).not.toContain("준비 중");
  });
});
