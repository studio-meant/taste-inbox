import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextualRail } from "@/components/collection/ContextualRail";
import { FilterSheet } from "@/components/collection/FilterSheet";
import { FilterChipRow, type FilterGroup } from "@/components/collection/FilterChipRow";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(),
}));

const GROUPS: readonly FilterGroup[] = [
  {
    key: "match",
    legend: "상품 확인",
    options: [
      { value: "exact", label: "정확히 확인됨", count: 3 },
      { value: "unknown", label: "확인 필요", count: 12 },
      { value: "similar", label: "유사한 곡", count: 0 },
    ],
  },
];

describe("ContextualRail", () => {
  it("narrows the collection and never navigates away from it", () => {
    // IA §7.3: "rail은 destination nav가 아니라 현재 collection의 범위를 좁힌다."
    render(<ContextualRail pathname="/library" params={{}} groups={GROUPS} />);

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/library/);
    }
  });

  it("gives every option an accessible name and a tooltip", () => {
    // At 64–72px only a glyph is visible, so both are mandatory (DESIGN.md §11.2).
    render(<ContextualRail pathname="/library" params={{}} groups={GROUPS} />);

    const option = screen.getByRole("link", { name: "정확히 확인됨 3개" });
    expect(option).toHaveAttribute("title", "정확히 확인됨 3개");
  });

  it("says the active option is selected, rather than only painting it", () => {
    // CLAUDE.md §6. The tonal tile is colour and the Check glyph is aria-hidden, so the
    // accessible name is the only other channel — and it has to differ between states.
    // This was `aria-pressed`, which role=link discards: the name was identical on and off.
    render(<ContextualRail pathname="/library" params={{ match: "exact" }} groups={GROUPS} />);
    const on = screen.getByRole("link", { name: /정확히 확인됨/ });
    const off = screen.getByRole("link", { name: /확인 필요/ });

    expect(on).toHaveAccessibleName("정확히 확인됨 3개, 선택됨");
    expect(off).toHaveAccessibleName("확인 필요 12개");
    // aria-current is the repo's marker on links (GlobalNavPill, MobileBottomNav).
    expect(off).not.toHaveAttribute("aria-current");
  });

  it("drops an option nothing would match", () => {
    render(<ContextualRail pathname="/library" params={{}} groups={GROUPS} />);
    expect(screen.queryByRole("link", { name: /유사한 곡/ })).not.toBeInTheDocument();
  });

  it("renders nothing when no group can separate the board", () => {
    const { container } = render(<ContextualRail pathname="/library" params={{}} groups={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a way back to the whole collection through the row that is on", () => {
    /*
     * The "필터 지우기" row was removed on 2026-08-10. It is not replaced, because it was
     * never the only way out: these rows are single-select, so the selected one links to
     * the board with its own group dropped — clicking it again *is* the clear.
     */
    render(<ContextualRail pathname="/library" params={{ match: "exact" }} groups={GROUPS} />);

    expect(screen.getByRole("link", { name: /정확히 확인됨/ })).toHaveAttribute("href", "/library");
    expect(screen.queryByText("필터 지우기")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /지우기/ })).not.toBeInTheDocument();
  });
});

describe("FilterSheet", () => {
  function open(params: Record<string, string> = {}, activeCount = 0) {
    render(
      <FilterSheet pathname="/library" params={params} groups={GROUPS} activeCount={activeCount} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /필터/ }));
  }

  it("is a modal dialog with a name", () => {
    // Nothing in the thirteen documents specifies these; the choice is recorded in
    // docs/DECISIONS.md so the next sheet copies it.
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "필터" })).toBeInTheDocument();
  });

  it("applies in one commit rather than on every tap", () => {
    // FRONTEND §16: "mobile sheet applies in batch". On a phone the sheet covers the
    // board, so navigating per tap would change results nobody can see.
    open();
    fireEvent.click(screen.getByRole("button", { name: /정확히 확인됨/ }));
    fireEvent.click(screen.getByRole("button", { name: /확인 필요/ }));

    const apply = screen.getByRole("link", { name: "2개 적용" });
    expect(apply.getAttribute("href")).toContain("match=exact%2Cunknown");
  });

  it("counts selections per group while the sheet is open", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /정확히 확인됨/ }));
    expect(within(screen.getByRole("dialog")).getByText("1")).toBeInTheDocument();
  });

  it("starts from what the URL already says", () => {
    open({ match: "exact" }, 1);
    expect(screen.getByRole("button", { name: /정확히 확인됨/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clears back to the whole collection", () => {
    open({ match: "exact" }, 1);
    fireEvent.click(screen.getByRole("button", { name: "초기화" }));
    expect(screen.getByRole("link", { name: "전체 보기" })).toHaveAttribute("href", "/library");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /필터/ })).toHaveFocus();
  });

  it("returns focus to the trigger after applying, not only after Escape", () => {
    // Apply is the way most people leave the sheet, and it called setOpen(false) directly:
    // the dialog unmounted with focus still on the link, so focus fell to document.body and
    // the next Tab restarted from the top of the page.
    open();
    fireEvent.click(screen.getByRole("button", { name: /정확히 확인됨/ }));

    const apply = screen.getByRole("link", { name: "1개 적용" });
    // In the app the router intercepts the click; there is no router here, so jsdom would
    // try the navigation for real and log "Not implemented". Suppressed at the target
    // phase, which leaves React's onClick — the thing under test — untouched.
    apply.addEventListener("click", (event) => {
      event.preventDefault();
    });
    fireEvent.click(apply);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /필터/ })).toHaveFocus();
  });

  it("offers a dismiss target that is reachable without a mouse", () => {
    open();
    expect(screen.getByRole("button", { name: "필터 닫기" })).toBeInTheDocument();
  });

  it("shows how many filters are already on before it is opened", () => {
    render(
      <FilterSheet
        pathname="/library"
        params={{ match: "exact" }}
        groups={GROUPS}
        activeCount={1}
      />,
    );
    expect(screen.getByRole("button", { name: /필터/ })).toHaveTextContent("1");
  });
});

describe("FilterChipRow", () => {
  it("says the selected chip is selected, rather than only painting it", () => {
    // The third filter surface, with the same defect the rail had: a Check glyph that is
    // aria-hidden, a tonal fill, and aria-pressed on a role=link that discards it.
    render(<FilterChipRow pathname="/library" params={{ match: "exact" }} groups={GROUPS} />);

    const on = screen.getByRole("link", { name: /정확히 확인됨/ });
    const off = screen.getByRole("link", { name: /확인 필요/ });

    expect(on).toHaveAccessibleName("정확히 확인됨 3개, 선택됨");
    expect(off).toHaveAccessibleName("확인 필요 12개");
    expect(off).not.toHaveAttribute("aria-current");
  });

  it("makes every selected chip its own undo, now that the clear button is gone", () => {
    /*
     * The chips are multi-select, so this is the property that had to hold before
     * "필터 N개 지우기" could be removed: each chip that is on links to the board *without*
     * its own value, so a two-value selection unwinds in two clicks and neither of them
     * needs a control that clears everything.
     */
    render(
      <FilterChipRow pathname="/library" params={{ match: "exact,unknown" }} groups={GROUPS} />,
    );

    expect(screen.getByRole("link", { name: /정확히 확인됨/ })).toHaveAttribute(
      "href",
      "/library?match=unknown",
    );
    expect(screen.getByRole("link", { name: /확인 필요/ })).toHaveAttribute(
      "href",
      "/library?match=exact",
    );
    expect(screen.queryByRole("link", { name: /지우기/ })).not.toBeInTheDocument();
  });
});
