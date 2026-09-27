import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DeclinedPage from "@/app/(workspace)/none/page";
import { CollectionRail } from "@/components/collection/CollectionRail";
import { MockRepository } from "@/lib/mock/repository";
import { HttpRepository } from "@/lib/repository";
import { BROWSE_MODES } from "@/lib/navigation/browse-modes";
import { findActiveDestination } from "@/lib/navigation/routes";

/**
 * None — the visible inbox for items with no board yet.
 *
 * It covers two database states: pending Instagram Likes stay null so the classifier can
 * resume, while an explicit `none` records a final no-board decision. Both are visible here
 * and in Browse > All.
 *
 * The screen must describe that distinction honestly: null items can still move when the
 * classifier becomes available, while explicit `none` is precisely the value that stops it
 * asking (`enrich/classify.py::DECLINED`). Both can be assigned by hand now.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/none",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(workspace)/actions", () => ({
  // `"use server"` reaching `revalidatePath`, which needs a request context jsdom has not.
  // The write is covered by `apps/api/tests/test_api.py` and `tests/mock-repository.test.ts`.
  moveItemToBoard: vi.fn(),
}));

async function renderShelf(
  repository: MockRepository,
  params: Record<string, string> = {},
): Promise<ReturnType<typeof render>> {
  vi.spyOn(await import("@/lib/repository"), "getRepository").mockReturnValue(repository);
  return render(await DeclinedPage({ searchParams: Promise.resolve(params) }));
}

/** The first item on `/trends`, which is the fixture every move in this file starts from. */
async function firstTrendsItem(repository: MockRepository): Promise<string> {
  const { items } = await repository.listAIItems({ limit: Number.MAX_SAFE_INTEGER });
  const first = items[0];
  expect(first).toBeDefined();
  return first!.id;
}

/** A mock repository with `count` explicit None items (mock mode has no pending capture). */
async function withDeclined(count: number): Promise<MockRepository> {
  const repository = new MockRepository();
  const { items } = await repository.listAIItems({ limit: Number.MAX_SAFE_INTEGER });
  for (const item of items.slice(0, count)) {
    await repository.setItemBoard(item.id, "none");
  }
  return repository;
}

describe("the no-board inbox", () => {
  it("explains that pending items can move automatically or be filed by hand", async () => {
    // On a populated shelf: `BoardHeader` draws its note only over cards, which is the same
    // rule every board follows — a caption about items above no items is noise.
    await renderShelf(await withDeclined(1));

    expect(screen.getByRole("heading", { name: "None", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/자동 분류가 가능해지면 보드로 이동합니다/)).toBeInTheDocument();
    expect(screen.getByText(/직접 보드를 정할 수도 있어요/)).toBeInTheDocument();
  });

  it("names both states that fill it", async () => {
    await renderShelf(new MockRepository());

    expect(screen.getByRole("heading", { name: "여기 있는 항목이 없어요" })).toBeInTheDocument();
    expect(screen.getByText(/아직 분류되지 않은 항목/)).toBeInTheDocument();
    expect(screen.getByText(/보드를 None으로 바꾼 항목/)).toBeInTheDocument();
  });

  it("keeps the rail, so the shelf is not the only thing in the layout", async () => {
    // `/style` collapsing to 2px is why every board asserts this: the rail is the layout's
    // left column, and a column that is sometimes absent is a layout that is sometimes
    // absent.
    await renderShelf(new MockRepository());
    expect(screen.getByRole("navigation", { name: "Inbox 필터" })).toBeInTheDocument();
  });

  it("draws no filter over a shelf that has nothing to separate", async () => {
    const { container } = await renderShelf(new MockRepository());
    expect(screen.queryByRole("button", { name: /필터/ })).not.toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeNull();
  });

  it("shows every declined item with its board already set to None", async () => {
    // The point of the shelf: each card is one gesture from being somewhere else.
    const { container } = await renderShelf(await withDeclined(2));

    const cards = [...container.querySelectorAll("article")];
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const control = card.querySelector("select");
      expect(control).not.toBeNull();
      expect(control!).toHaveValue("none");
    }
  });

  it("still applies a day filter it was given, rather than accepting and ignoring it", async () => {
    const repository = await withDeclined(1);
    const spy = vi.spyOn(repository, "listDeclinedItems");

    await renderShelf(repository, { day: "2026-08-08" });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-08-08" }));
  });
});

describe("None in the navigation", () => {
  it("keeps the Browse destination active, because it is browsed the same way", () => {
    // Not a board, but reached from the same rail and rendered in the same shell. Leaving
    // it out would blank the global navigation while the user is standing on it.
    expect(findActiveDestination("/none")?.id).toBe("browse");
  });

  it("is listed in the rail and included in the complete All count", () => {
    /*
     * `/library` now merges this inbox, so the row and the cards have the same arithmetic.
     */
    render(
      <CollectionRail
        pathname="/none"
        params={{}}
        counts={{ ai: 8, style: 76, music: 3, places: 0, none: 12 }}
        sources={[]}
        groups={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "None 12개" })).toHaveAttribute("href", "/none");
    expect(screen.getByRole("link", { name: "All 99개" })).toBeInTheDocument();
  });

  it("gives every browse mode a distinct collapsed glyph", () => {
    // The rail collapses to 68px where only the first letter shows, so `None` had to not
    // collide with `Music` or `Places`.
    const glyphs = BROWSE_MODES.map((mode) => mode.label.slice(0, 1));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("the declined repository", () => {
  it("is empty until something is declined — no fixture ships one", async () => {
    // Nothing in this repository has ever been declined by anybody, so seeding the shelf
    // would be inventing decisions nobody made.
    const page = await new MockRepository().listDeclinedItems({ limit: 200 });
    expect(page.items).toEqual([]);
  });

  it("takes an item off the board it was on and puts it on the shelf", async () => {
    const repository = new MockRepository();
    const target = await firstTrendsItem(repository);

    await repository.setItemBoard(target, "none");

    const trends = await repository.listAIItems({ limit: Number.MAX_SAFE_INTEGER });
    const shelf = await repository.listDeclinedItems({ limit: Number.MAX_SAFE_INTEGER });
    expect(trends.items.map((item) => item.id)).not.toContain(target);
    expect(shelf.items.map((item) => item.id)).toEqual([target]);
  });

  it("keeps a declined item's own page reachable, and says it is on the shelf", async () => {
    // Its detail page is where it can be moved back from. Looking it up through a board
    // list would 404 the moment it was declined, which would make `none` a one-way door.
    const repository = new MockRepository();
    const target = await firstTrendsItem(repository);

    await repository.setItemBoard(target, "none");

    const detail = await repository.getItem(target);
    expect(detail?.board).toBe("none");
  });

  it("counts the shelf beside the boards and never inside one", async () => {
    const repository = new MockRepository();
    const before = await repository.getBoardCounts();
    const target = await firstTrendsItem(repository);

    await repository.setItemBoard(target, "none");
    const after = await repository.getBoardCounts();

    expect(after.none).toBe(before.none + 1);
    expect(after.ai).toBe(before.ai - 1);
  });

  it("asks the service for the shelf on its own route", async () => {
    // `/api/none/items`, not a `?board=none` on a board endpoint. The four boards answer
    // "what is filed here"; this answers "what was filed nowhere", over a different WHERE.
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: {
              items: [],
              nextCursor: null,
              generatedAt: "2026-08-08T07:00:00Z",
              origin: "collected",
            },
          }),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new HttpRepository("http://127.0.0.1:8787").listDeclinedItems({ day: "2026-08-08" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/none/items?day=2026-08-08",
      expect.anything(),
    );
    vi.unstubAllGlobals();
  });

  it("sends the move as a PATCH on the item, not as a settings write", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            data: {
              id: "ig-AAA",
              kind: "post",
              board: "none",
              title: "제목",
              body: "",
              source: {
                platform: "instagram",
                label: "Instagram",
                originalUrl: "https://www.instagram.com/p/AAA/",
                author: null,
                actionType: "like",
                firstSeenAt: "2026-08-08T07:00:00Z",
              },
              media: null,
              photos: [],
              tags: [],
              links: [],
              author: null,
              evidence: [],
              sourcePublishedAt: null,
              checkedAt: null,
              firstSeenAt: "2026-08-08T07:00:00Z",
            },
          }),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);

    const item = await new HttpRepository("http://127.0.0.1:8787").setItemBoard("ig-AAA", "none");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/items/ig-AAA/board",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ board: "none" }) }),
    );
    // Read back off the response rather than echoed from the request.
    expect(item.board).toBe("none");
    vi.unstubAllGlobals();
  });
});
