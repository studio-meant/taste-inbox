import type { AIItemCardModel } from "@taste-inbox/shared";
import { render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CollectionCalendar } from "@/components/collection/CollectionCalendar";
import { CollectionRail } from "@/components/collection/CollectionRail";
import {
  canNarrowByDay,
  collectedDays,
  collectedMonths,
  localDay,
  monthWeeks,
  type CollectedDay,
} from "@/lib/filters/collected-days";
import { activeFilterCount, isUnfiltered, parseAIFilters } from "@/lib/filters/board-filters";
import { MockRepository } from "@/lib/mock/repository";
import { sourcePath } from "./source-files";
import type { AIItemQuery, Page, TasteInboxRepository } from "@/lib/repository/types";

/**
 * 수집한 날 — the calendar in the rail, and the rule it groups by.
 *
 * The assertion this file exists for is the timezone one. `first_seen_at` is stamped in
 * UTC, the product reasons in Asia/Seoul, and the two disagree about the date for nine
 * hours out of every twenty-four — so a calendar written against the UTC prefix looks
 * perfectly correct until someone saves something before nine in the morning. The API
 * makes the same conversion in `today.py::_local_day`; a board that filed an item on a
 * different day than Today does would be two screens contradicting each other.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/trends",
  useSearchParams: () => new URLSearchParams(),
}));

const repository = vi.hoisted(() => ({ current: null as unknown as TasteInboxRepository }));

vi.mock("@/lib/repository", () => ({
  getRepository: () => repository.current,
}));

/** Imported after the mock, so the page sees it. */
const { default: TrendsPage } = await import("@/app/(workspace)/trends/page");

const COUNTS = { ai: 8, style: 76, music: 3, places: 0, none: 0 } as const;

describe("which day an item was collected on", () => {
  it("files a UTC evening on the Seoul morning that follows it", () => {
    /*
     * The assertion that catches a UTC/local mix-up. 2026-08-08T15:30:00Z is 2026-08-09
     * at 00:30 in Asia/Seoul — the day *after* the one its own string spells. Read as a
     * UTC date prefix this item lands on the 8th, and the Today screen, which converts,
     * would be counting it on the 9th at the same moment.
     */
    expect(localDay("2026-08-08T15:30:00Z")).toBe("2026-08-09");
    // And the last second before the boundary stays where it is.
    expect(localDay("2026-08-08T14:59:59Z")).toBe("2026-08-08");
  });

  it("reads an offset stamp as the instant it names, not as its digits", () => {
    // A collected item carries whatever offset the capture recorded, and these two are the
    // same moment (`lib/collection/merged-board` hit the same thing sorting them).
    expect(localDay("2026-08-08T13:00:00+09:00")).toBe(localDay("2026-08-08T04:00:00Z"));
  });

  it("reads a stamp with no zone as UTC rather than as this machine's clock", () => {
    // `today.py::_local_day` decided this: reading a bare stamp as machine-local would move
    // the day boundary by however far the host happens to be from UTC.
    expect(localDay("2026-08-08T15:30:00")).toBe("2026-08-09");
  });

  it("leaves an unreadable stamp out rather than guessing it onto a day", () => {
    expect(localDay("not a timestamp")).toBeNull();
    expect(
      collectedDays([item("a", "not a timestamp"), item("b", "2026-08-08T01:00:00Z")]),
    ).toEqual([{ day: "2026-08-08", count: 1 }]);
  });

  it("counts only the days that collected something", () => {
    // Days with nothing are absent, not listed as zero: a run of empty rows reads as a
    // broken collector when it usually means the user saved nothing.
    const days = collectedDays([
      item("a", "2026-08-08T01:00:00Z"),
      item("b", "2026-08-08T02:00:00Z"),
      item("c", "2026-08-09T15:30:00Z"), // 2026-08-10 in Seoul
    ]);
    expect(days).toEqual([
      { day: "2026-08-08", count: 2 },
      { day: "2026-08-10", count: 1 },
    ]);
    // Nothing on the 9th, and nothing claiming there was.
    expect(days.map((entry) => entry.day)).not.toContain("2026-08-09");
  });

  it("agrees with the seed fixtures, which span two UTC dates and one Seoul day", async () => {
    /*
     * Not a contrived stamp: the committed seed runs from 2026-08-07T21:05Z to
     * 2026-08-08T06:40Z, which is 06:05 to 15:40 on one Seoul day. Grouped by the UTC
     * prefix this board would show two days and split the collection run in half.
     */
    const { items } = await new MockRepository().listAIItems({ limit: 200 });
    expect(collectedDays(items)).toEqual([{ day: "2026-08-08", count: items.length }]);
  });

  it("treats one day holding everything as a fact, not a filter", () => {
    // `facets.ts::isUseful`, specialised: a control that answers with the board already on
    // screen reads as "no matches", a claim about the items (DESIGN.md §3.5).
    expect(canNarrowByDay([{ day: "2026-08-08", count: 142 }])).toBe(false);
    expect(
      canNarrowByDay([
        { day: "2026-08-08", count: 142 },
        { day: "2026-08-10", count: 6 },
      ]),
    ).toBe(true);
  });

  it("lays a month out from the calendar, not from the host timezone", () => {
    // 2026-08-01 is a Saturday, so August starts with six blanks and ends on the 31st.
    const weeks = monthWeeks("2026-08");
    expect(weeks[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(weeks.flat().filter((day) => day !== null)).toHaveLength(31);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // February in a non-leap year, as the off-by-one guard.
    expect(
      monthWeeks("2026-02")
        .flat()
        .filter((day) => day !== null),
    ).toHaveLength(28);
  });

  it("collects months in order, each once", () => {
    expect(
      collectedMonths([
        { day: "2026-07-30", count: 1 },
        { day: "2026-08-08", count: 2 },
        { day: "2026-08-10", count: 1 },
      ]),
    ).toEqual(["2026-07", "2026-08"]);
  });
});

const SPARSE: readonly CollectedDay[] = [
  { day: "2026-08-08", count: 142 },
  { day: "2026-08-10", count: 6 },
];

describe("the calendar in the rail", () => {
  function renderCalendar(params: Record<string, string> = {}, days = SPARSE) {
    return render(<CollectionCalendar pathname="/trends" params={params} days={days} />);
  }

  it("lists the days that have items, with their counts", () => {
    renderCalendar();

    expect(screen.getByRole("link", { name: "8월 8일 토요일 142개" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "8월 10일 월요일 6개" })).toBeInTheDocument();
    // Two live days in a month of thirty-one, which is what the real data looks like.
    expect(screen.getAllByRole("link", { name: /개$|개,/ })).toHaveLength(2);
  });

  it("draws a day with nothing on it as a number, not as a control", () => {
    renderCalendar();

    // The 9th is between two collection days and had nothing. It is on the calendar,
    // because a month with a hole in it is not a month — and it is not clickable.
    expect(screen.queryByRole("link", { name: /8월 9일/ })).not.toBeInTheDocument();
    expect(screen.getByTitle("8월 9일 일요일 · 수집한 항목 없음")).toBeInTheDocument();
  });

  it("does not rely on colour to say a day has items or is selected", () => {
    // CLAUDE.md §6 / DESIGN.md §18. Three channels, and the two that matter here are not
    // paint: a day with items is a link and a day without is text, and the selected day
    // says so in its own accessible name.
    const { rerender } = renderCalendar();
    const day = screen.getByRole("link", { name: "8월 8일 토요일 142개" });
    expect(day.tagName).toBe("A");
    expect(day).toHaveAttribute("title", "8월 8일 토요일 142개");

    rerender(
      <CollectionCalendar pathname="/trends" params={{ day: "2026-08-08" }} days={SPARSE} />,
    );
    expect(screen.getByRole("link", { name: "8월 8일 토요일 142개, 선택됨" })).toBeInTheDocument();
  });

  it("filters the board on a click and clears on the next one", () => {
    // Single-select, like the rail's source rows — and with "필터 지우기" gone this second
    // click is the way back to the whole board.
    const { rerender } = renderCalendar();
    expect(screen.getByRole("link", { name: /8월 8일/ })).toHaveAttribute(
      "href",
      "/trends?day=2026-08-08",
    );

    rerender(
      <CollectionCalendar pathname="/trends" params={{ day: "2026-08-08" }} days={SPARSE} />,
    );
    expect(screen.getByRole("link", { name: /8월 8일/ })).toHaveAttribute("href", "/trends");
    // And picking a different day replaces the selection rather than adding to it.
    expect(screen.getByRole("link", { name: /8월 10일/ })).toHaveAttribute(
      "href",
      "/trends?day=2026-08-10",
    );
  });

  it("keeps the other filters when a day is picked", () => {
    renderCalendar({ source: "github", sort: "oldest" });
    const href = screen.getByRole("link", { name: /8월 8일/ }).getAttribute("href") ?? "";
    expect(href).toContain("source=github");
    expect(href).toContain("sort=oldest");
    expect(href).toContain("day=2026-08-08");
  });

  it("is a real href on every day, so it works before hydration", () => {
    // `ContextualRail`'s rule: browser back undoes a filter and there is no state to keep
    // in sync. Nothing here is a button.
    renderCalendar();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/trends/);
    }
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows one month, and steps only to months that collected something", () => {
    const across: readonly CollectedDay[] = [
      { day: "2026-06-30", count: 4 },
      { day: "2026-08-08", count: 142 },
    ];
    const { rerender } = renderCalendar({}, across);

    // Opens on the newest month, because the newest thing collected is what a person came
    // to look at — and July, which collected nothing, is not a place the pager can land.
    expect(screen.getByText("2026년 8월")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026년 6월 보기" })).toHaveAttribute(
      "href",
      "/trends?cal=2026-06",
    );
    expect(screen.queryByRole("link", { name: /7월/ })).not.toBeInTheDocument();

    rerender(<CollectionCalendar pathname="/trends" params={{ cal: "2026-06" }} days={across} />);
    expect(screen.getByText("2026년 6월")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "6월 30일 화요일 4개" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026년 8월 보기" })).toHaveAttribute(
      "href",
      "/trends?cal=2026-08",
    );
  });

  it("opens on the selected day's month, and lets the pager move off it", () => {
    const across: readonly CollectedDay[] = [
      { day: "2026-06-30", count: 4 },
      { day: "2026-08-08", count: 142 },
    ];
    render(<CollectionCalendar pathname="/trends" params={{ day: "2026-06-30" }} days={across} />);
    expect(screen.getByText("2026년 6월")).toBeInTheDocument();

    // `?cal=` wins over the selection. The other order pins the calendar to the selected
    // day's month and the pager appears to do nothing.
    cleanupRender();
    render(
      <CollectionCalendar
        pathname="/trends"
        params={{ day: "2026-06-30", cal: "2026-08" }}
        days={across}
      />,
    );
    expect(screen.getByText("2026년 8월")).toBeInTheDocument();
  });

  it("ignores a month nothing was collected in rather than drawing a dead grid", () => {
    renderCalendar({ cal: "2019-01" });
    expect(screen.getByText("2026년 8월")).toBeInTheDocument();
  });

  it("renders nothing at all when the board has collected nothing", () => {
    const { container } = renderCalendar({}, []);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the rail's day block", () => {
  it("says the one day as a count when every item landed on it", () => {
    // The live seed board is exactly this: one backfill, one timestamp. A calendar whose
    // single live day answers with the board already on screen is not a control.
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={[]}
        groups={[]}
        days={[{ day: "2026-08-08", count: 142 }]}
      />,
    );

    expect(screen.getByText("8월 8일 (토)")).toBeInTheDocument();
    expect(screen.getByText("142개")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /8월 8일/ })).not.toBeInTheDocument();
  });

  it("becomes a calendar as soon as a second day exists", () => {
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={[]}
        groups={[]}
        days={SPARSE}
      />,
    );
    expect(screen.getByRole("link", { name: "8월 8일 토요일 142개" })).toHaveAttribute(
      "href",
      "/style?day=2026-08-08",
    );
  });

  it("says nothing about days on a board that has none", () => {
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={[]}
        groups={[]}
        days={[]}
      />,
    );
    expect(screen.queryByText("수집한 날")).not.toBeInTheDocument();
  });
});

describe("?day= on a board", () => {
  /**
   * A repository whose items are spread across two days.
   *
   * The seed lands on one Seoul day by construction, which is the right fixture for the
   * grouping rule and the wrong one for the filter. This re-stamps it and applies `?day=`
   * with the same `localDay` the calendar counts with — so what is under test here is the
   * page: that it parses the key, hands it to the repository, and renders the answer.
   * `MockRepository` and `HttpRepository` are checked against their own suites.
   */
  class TwoDays extends MockRepository {
    static readonly early = "2026-08-08";
    static readonly late = "2026-08-10";

    override async listAIItems(query?: AIItemQuery): Promise<Page<AIItemCardModel>> {
      const { day, ...rest } = query ?? {};
      const page = await super.listAIItems(rest);
      const items = page.items.map((item, index) => ({
        ...item,
        source: {
          ...item.source,
          // Alternating, so neither day is the whole board and the calendar is a control.
          firstSeenAt: index % 2 === 0 ? "2026-08-08T01:00:00Z" : "2026-08-09T15:30:00Z",
        },
      }));
      return {
        ...page,
        items:
          day === undefined
            ? items
            : items.filter((item) => localDay(item.source.firstSeenAt) === day),
      };
    }
  }

  async function renderTrends(params: Record<string, string> = {}) {
    repository.current = new TwoDays();
    return render(await TrendsPage({ searchParams: Promise.resolve(params) }));
  }

  function cardIds(container: HTMLElement): readonly string[] {
    return [...container.querySelectorAll('a[href^="/items/"]')].map((link) =>
      new URL(link.getAttribute("href") ?? "", "https://taste-inbox.local").pathname.replace(
        "/items/",
        "",
      ),
    );
  }

  it("renders only that day's items — parsed and applied", async () => {
    /*
     * docs/DECISIONS.md (2026-08-08): a filter that is parsed must be applied. A board that
     * read `?day=` and rendered every day would contradict the link it came from, which is
     * worse than not offering the filter at all.
     */
    const whole = await renderTrends();
    const everything = cardIds(whole.container);
    cleanupRender();

    const oneDay = await renderTrends({ day: TwoDays.early });
    const shown = cardIds(oneDay.container);

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(everything.length);
    expect(everything).toEqual(expect.arrayContaining([...shown]));

    // The other day's items are gone, not merely reordered.
    cleanupRender();
    const otherDay = await renderTrends({ day: TwoDays.late });
    for (const id of cardIds(otherDay.container)) {
      expect(shown).not.toContain(id);
    }
  });

  it("says so rather than showing an unfiltered board when a day matches nothing", async () => {
    // `NoMatches`, not the empty state: the board has items and this day has none, which is
    // a different fact from "you have saved nothing".
    const { container } = await renderTrends({ day: "2026-08-09" });

    expect(screen.getByText("이 조건에 맞는 항목이 없어요")).toBeInTheDocument();
    expect(screen.queryByText("아직 항목이 없어요")).not.toBeInTheDocument();
    expect(cardIds(container)).toHaveLength(0);
  });

  it("puts the selected day on the calendar and offers the click that clears it", async () => {
    await renderTrends({ day: TwoDays.early });

    const calendar = screen.getByRole("link", { name: /8월 8일 토요일 .*선택됨/ });
    // Built from the unfiltered board, so the day you picked is still there to unpick.
    expect(calendar).toHaveAttribute("href", "/trends");
  });

  it("keeps the day removable on the narrow surface the rail does not reach", async () => {
    /*
     * The calendar is rail-only, and the rail is not rendered below 768px. Without a chip
     * the day would be a filter with no control anywhere on a phone. It appears only while
     * a day is selected, and it clears itself.
     */
    const { container } = await renderTrends({ day: TwoDays.early });
    const controls = container.querySelector("[class*='controls']");
    expect(controls).not.toBeNull();

    const chip = within(controls as HTMLElement).getByRole("link", { name: /8월 8일/ });
    expect(chip).toHaveAttribute("href", "/trends");

    cleanupRender();
    const unfiltered = await renderTrends();
    const bar = unfiltered.container.querySelector("[class*='controls']");
    expect(within(bar as HTMLElement).queryByText("수집한 날")).toBeNull();
  });

  it("carries a malformed day out rather than silently opening an unfiltered board", () => {
    const filters = parseAIFilters({ day: "2026-13-40" });
    expect(filters.day).toBeNull();
    expect(isUnfiltered(filters)).toBe(true);
    expect(activeFilterCount(parseAIFilters({ day: "2026-08-08" }))).toBe(1);
  });
});

describe("필터 지우기", () => {
  it("is gone from every component in the app", () => {
    /*
     * A source scan rather than a render assertion, because the control could come back on
     * a surface no test happens to render. `NoMatches` is deliberately not caught by this:
     * its "필터 지우고 전체 보기" is a sentence on an empty board, which is the one state
     * where there is nothing left to click off — and it is the escape the removal leans on.
     */
    const offenders = sourceFiles(sourcePath())
      .filter((path) => withoutComments(readFileSync(path, "utf8")).includes("필터 지우기"))
      .map((path) => path.replace(sourcePath(), "src"));
    expect(offenders).toEqual([]);
  });

  it("leaves the boards' own filters clearable without it", () => {
    // The property the removal rests on, stated once: every control that sets a filter
    // links to the board without it.
    render(
      <CollectionRail
        pathname="/trends"
        params={{ source: "github", day: "2026-08-08" }}
        counts={COUNTS}
        sources={[]}
        groups={[
          {
            key: "source",
            legend: "출처",
            options: [
              { value: "github", label: "GitHub", count: 2 },
              { value: "instagram", label: "Instagram", count: 6 },
            ],
          },
        ]}
        days={SPARSE}
      />,
    );

    expect(screen.getByRole("link", { name: "GitHub 2개, 선택됨" })).toHaveAttribute(
      "href",
      "/trends?day=2026-08-08",
    );
    expect(screen.getByRole("link", { name: /8월 8일 토요일 .*선택됨/ })).toHaveAttribute(
      "href",
      "/trends?source=github",
    );
  });

  it("leaves the rail's own board row as the way out of any state at all", () => {
    /*
     * The backstop, and the reason no reachable state is a trap even when a filter has no
     * control of its own on this screen — `?day=` on `/style`, where one day holds
     * everything and the calendar is a count. "Browse by type" links to the bare route, so
     * the row for the board you are already on clears every filter in one click.
     */
    render(
      <CollectionRail
        pathname="/style"
        params={{ source: "instagram", day: "2026-08-08", cal: "2026-08", density: "compact" }}
        counts={COUNTS}
        sources={[{ platform: "instagram", label: "Instagram", count: 76 }]}
        groups={[]}
        days={[{ day: "2026-08-08", count: 76 }]}
      />,
    );

    const here = screen.getByRole("link", { name: "Style 76개" });
    expect(here).toHaveAttribute("href", "/style");
    expect(here).toHaveAttribute("aria-current", "page");
  });
});

function item(id: string, firstSeenAt: string) {
  return { id, source: { firstSeenAt } };
}

/** Every `.ts`/`.tsx` file under `src/`. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The file with its comments removed.
 *
 * Several of them name the control on purpose — a removal is worth explaining where it
 * used to be — and a scan that could not tell a docstring from a label would either fail
 * on the explanation or force the explanation out of the code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * `render` twice in one test leaves both trees mounted, and `getByRole` then finds two of
 * everything. The suite's global cleanup runs between tests, not inside one.
 */
function cleanupRender(): void {
  document.body.innerHTML = "";
}
