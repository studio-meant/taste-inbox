import { AIItemCardModelSchema } from "@taste-inbox/shared";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PlacesPage from "@/app/(workspace)/places/page";
import { CollectionRail } from "@/components/collection/CollectionRail";
import { MockRepository } from "@/lib/mock/repository";
import { HttpRepository } from "@/lib/repository";
import { BROWSE_MODES } from "@/lib/navigation/browse-modes";
import { findActiveDestination } from "@/lib/navigation/routes";

/**
 * Places — the fourth board, and today an empty one.
 *
 * Almost every assertion here is about a board with nothing on it, which is the state it
 * will be in until a classifier files something onto it. That is the point: an empty board
 * is the one this product has to render honestly, and the failure it must not have is the
 * one the other boards already hit — chrome that promises a control over items that are not
 * there (a filter bar with no facets), or copy that blames a collector that is not coming.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/places",
  useSearchParams: () => new URLSearchParams(),
}));

const repository = new MockRepository();

/** The page is an async Server Component: awaiting it yields the element to render. */
async function renderPlaces(params: Record<string, string> = {}) {
  return render(await PlacesPage({ searchParams: Promise.resolve(params) }));
}

describe("the places board", () => {
  it("says what will fill it, rather than only that it is empty", async () => {
    await renderPlaces();

    expect(screen.getByRole("heading", { name: "Places", level: 1 })).toBeInTheDocument();
    const empty = screen.getByRole("heading", { name: "아직 장소가 없어요", level: 2 });
    expect(empty).toBeInTheDocument();
    // The copy names the missing step — a decision — rather than a collector on its way.
    // Nothing is on its way: these posts are already collected, and since 2026-08-12 both
    // the classifier and the board picker can send one here.
    expect(screen.getByText(/분류가 아직 아무것도 여기로 보내지 않았어요/)).toBeInTheDocument();
  });

  it("draws no filter over a board that has nothing to separate", async () => {
    // A filter bar above an empty state offers a control that can only ever answer with the
    // same empty board — which reads as "no matches", a claim about the items rather than
    // about the product (DESIGN.md §3.5, and `facets.ts`'s own rule).
    const { container } = await renderPlaces();

    expect(screen.queryByRole("button", { name: /필터/ })).not.toBeInTheDocument();
    expect(container.querySelector("fieldset")).toBeNull();
  });

  it("keeps the rail, so the board is not the only thing in the layout", async () => {
    // `/style` collapsing to 2px is why this is asserted rather than assumed: the rail is
    // the layout's left column, and a column that is sometimes absent is a layout that is
    // sometimes absent.
    await renderPlaces();
    expect(screen.getByRole("navigation", { name: "Inbox 필터" })).toBeInTheDocument();
  });

  it("does not claim an empty board is sample data", async () => {
    // There is no places fixture and there should not be one — inventing restaurants on a
    // board whose real state is "nothing classified" is the failure DESIGN.md §3.5 names.
    // So the header must not badge the emptiness as 샘플 데이터 either.
    await renderPlaces();
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
    expect(screen.getByText("수집됨")).toBeInTheDocument();
  });

  it("still applies a day filter it was given, rather than accepting and ignoring it", async () => {
    // The board is empty, so nothing changes on screen — but `/library` answers one `?day=`
    // across every board, and a list that parsed the parameter without applying it is the
    // failure docs/DECISIONS.md (2026-08-08) calls worse than not offering the filter.
    const spy = vi.spyOn(MockRepository.prototype, "listPlacesItems");
    await renderPlaces({ day: "2026-08-08" });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-08-08" }));
    spy.mockRestore();
  });
});

describe("places in the navigation", () => {
  it("is a Browse mode, not a fourth destination", () => {
    // The same decision Music got (docs/DECISIONS.md, 2026-08-08): the pill carries Today
    // and Browse, and a board is a mode inside Browse.
    expect(findActiveDestination("/places")?.id).toBe("browse");
  });

  it("is listed in the rail while it is still empty", () => {
    // A board that appears only once it has items cannot be found by the person asking
    // where their saved restaurants went. An honest `0` says more than an absence.
    render(
      <CollectionRail
        pathname="/places"
        params={{}}
        counts={{ ai: 8, style: 76, music: 3, places: 0, none: 0 }}
        sources={[]}
        groups={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "Places 0개" })).toHaveAttribute("href", "/places");
    // `All` accounts for every board, so a board missing from the sum would make the merged
    // route's own count disagree with the rail sitting beside it.
    expect(screen.getByRole("link", { name: "All 87개" })).toBeInTheDocument();
  });

  it("gives every browse mode a distinct collapsed glyph", () => {
    // The rail collapses to a 68px column where only the first letter shows. Two boards
    // sharing a letter would be two rows a person cannot tell apart at that width.
    const glyphs = BROWSE_MODES.map((mode) => mode.label.slice(0, 1));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("the places repository", () => {
  it("is empty, and empty is the whole fixture", async () => {
    const page = await repository.listPlacesItems({ limit: 200 });
    expect(page.items).toEqual([]);
  });

  it("counts as its own board rather than folding into another", async () => {
    const counts = await repository.getBoardCounts();
    expect(counts.places).toBe(0);
  });

  it("serves the Trends card model, which is the decision this board rests on", async () => {
    // A saved place is an Instagram post: a caption, a photo, hashtags and its links. If a
    // fourth model is ever added, this is the test that has to be rewritten deliberately
    // rather than a board that quietly grows a rating nothing produces.
    const page = await repository.listPlacesItems({ limit: 200 });
    for (const item of page.items) {
      expect(() => AIItemCardModelSchema.parse(item)).not.toThrow();
    }
  });
});

describe("the live places board", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the service for its own endpoint, with the filters it was given", async () => {
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

    await new HttpRepository("http://127.0.0.1:8787").listPlacesItems({
      source: ["instagram"],
      day: "2026-08-08",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/api/places/items?source=instagram&day=2026-08-08",
      expect.anything(),
    );
  });

  it("reads the places count out of /api/health with the others", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({
              data: {
                status: "ok",
                boards: { trends: 8, style: 76, music: 3, places: 2, none: 5 },
              },
            }),
        } as Response),
      ),
    );

    const counts = await new HttpRepository("http://127.0.0.1:8787").getBoardCounts();
    // `none` travels with them and is never folded into one of them — see `BoardCounts`.
    expect(counts).toEqual({ ai: 8, style: 76, music: 3, places: 2, none: 5 });
  });
});
