import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSource } from "./source-files";
import { AmbientCanvas } from "@/components/shell/AmbientCanvas";
import { AppShell } from "@/components/shell/AppShell";
import { ContextBar } from "@/components/shell/ContextBar";
import { GlobalNavPill } from "@/components/shell/GlobalNavPill";
import {
  WorkspaceStatusButton,
  type WorkspaceStatus,
} from "@/components/shell/WorkspaceStatusButton";
import { TasteQueryDock } from "@/components/query/TasteQueryDock";
import { WorkspaceQueryDock } from "@/components/query/WorkspaceQueryDock";

const pathname = vi.hoisted(() => ({ current: "/today" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  pathname.current = "/today";
});

/** See `./source-files` for why this is not a plain `resolve(process.cwd(), …)`. */
function readModule(relative: string): string {
  return readSource(relative);
}

/* ────────────────────────────────────────────────────────── scenic backdrop */

describe("AmbientCanvas", () => {
  it("is decorative: hidden from assistive technology and out of the tab order", () => {
    const { container } = render(<AmbientCanvas intensity="quiet" />);
    const root = container.firstElementChild;

    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("aria-hidden", "true");
    // Nothing inside it is reachable: no landmark, no control, no image role.
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("marks the scenic art aria-hidden as well, so the SVG is not announced twice", () => {
    const { container } = render(<AmbientCanvas />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 1440 960");
    expect(svg).toHaveAttribute("preserveAspectRatio", "none");
  });

  it("draws the reference's layered world, not a flat wash", () => {
    const { container } = render(<AmbientCanvas />);

    // Seven hills, back to front, then the water body, then five surface lines.
    const paths = [...container.querySelectorAll("path")];
    expect(paths).toHaveLength(13);
    expect(container.querySelector("g")?.getAttribute("transform")).toBe("translate(0 84)");
    expect(
      paths.filter((path) => path.getAttribute("fill") === "url(#scenic-water-gradient)"),
    ).toHaveLength(1);
    expect(container.querySelector("linearGradient")?.id).toBe("scenic-water-gradient");
  });

  it("keeps the quiet reading state distinct from the full scenic one", () => {
    const { container: full } = render(<AmbientCanvas intensity="scenic" />);
    const { container: quiet } = render(<AmbientCanvas intensity="quiet" />);
    const { container: tonal } = render(<AmbientCanvas intensity="tonal" />);

    const classesOf = (node: Element | null) => node?.getAttribute("class") ?? "";
    expect(classesOf(quiet.firstElementChild).split(" ").length).toBeGreaterThan(
      classesOf(full.firstElementChild).split(" ").length,
    );
    // `tonal` and `quiet` both fold onto the reference's single `.quiet` state.
    expect(classesOf(tonal.firstElementChild)).toBe(classesOf(quiet.firstElementChild));
  });

  it("never traps a pointer event meant for the content above it", () => {
    // jsdom applies no stylesheet, so the guarantee is asserted at its source.
    const css = readModule("components/shell/AmbientCanvas.module.css");
    expect(css).toMatch(/\.backdrop\s*\{[^}]*pointer-events:\s*none/);
  });
});

describe("reduced motion", () => {
  /*
   * `prefers-reduced-motion` is not observable in jsdom — no stylesheet is applied and
   * `matchMedia` is not implemented. What *is* checkable, and what actually regresses,
   * is that every infinite loop this shell owns is switched off under both triggers:
   * the OS preference and the product's own `data-motion="reduced"` (DESIGN.md §18).
   */
  it.each([
    ["components/shell/AmbientCanvas.module.css", ["drift"]],
    ["components/query/TasteQueryDock.module.css", ["orbSpin", "orbBreathe"]],
  ])("%s switches its loops off under both triggers", (file, loops) => {
    const css = readModule(file);

    for (const loop of loops) {
      expect(css).toContain(`@keyframes ${loop}`);
      expect(css).toMatch(new RegExp(`animation:\\s*${loop}[^;]*infinite`));
    }

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation:\s*none\s*!important/);
    expect(css).toContain(':global(:root[data-motion="reduced"])');
  });

  it("drops the status button's hover rotation under both triggers", () => {
    const css = readModule("components/shell/WorkspaceStatusButton.module.css");

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain(':global(:root[data-motion="reduced"])');
    expect(css.match(/transform:\s*none/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

/* ─────────────────────────────────────────────────────────────── context bar */

describe("ContextBar", () => {
  it("stacks the identity over its quiet second line", () => {
    render(<ContextBar profileName="Suzie" />);

    expect(screen.getByText("Suzie")).toBeInTheDocument();
    // Defaults to the literal truth about this product: one host, no account.
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("stacks the time over the date", () => {
    const { container } = render(<ContextBar timeLabel="오후 8:42" dateLabel="8월 8일 금요일" />);

    // The clock corrects itself to *now* the moment it mounts, so the labels passed in are
    // the server's first paint rather than what stays on screen. What this asserts is the
    // arrangement — a time in `strong` over a date in `small`, in that order.
    const time = container.querySelector("strong");
    const date = container.querySelector("small");
    expect(time?.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(date?.textContent).toMatch(/\d+월 \d+일/);
    expect(time?.compareDocumentPosition(date as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows the current time rather than the time the page was built", () => {
    /*
     * The bar is rendered by a Server Component, so without a client tick it showed
     * whenever the HTML happened to be produced — a clock that only moved on reload, which
     * reads as broken rather than as "when this screen was built".
     */
    render(<ContextBar timeLabel="오후 8:42" dateLabel="8월 8일 금요일" />);

    const now = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());

    expect(screen.getByText(now)).toBeInTheDocument();
    expect(screen.queryByText("오후 8:42")).toBeNull();
  });

  it("shows a time with no date under it without inventing one", () => {
    const { container } = render(<ContextBar timeLabel="오후 8:42" />);
    expect(container.querySelector("strong")?.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(container.querySelector("small")).toBeNull();
  });

  it("shows the date alone rather than inventing a time", () => {
    render(<ContextBar dateLabel="8월 8일 금요일" />);
    expect(screen.getByText("8월 8일 금요일")).toBeInTheDocument();
  });

  it("keeps the avatar out of the accessibility tree — the name is already there", () => {
    const { container } = render(<ContextBar profileName="수지" />);
    const avatar = container.querySelector('[aria-hidden="true"]');

    expect(avatar).not.toBeNull();
    // `Array.from` so a multi-byte first character is not split.
    expect(avatar).toHaveTextContent("수");
  });
});

/* ──────────────────────────────────────────────────────────────── nav switch */

describe("GlobalNavPill", () => {
  it("adds the slider without adding anything to the accessibility tree", () => {
    render(<GlobalNavPill />);
    const nav = screen.getByRole("navigation", { name: "주요 화면" });

    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    expect(nav.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(nav.firstElementChild).toBeEmptyDOMElement();
  });

  it("drives the slider from the same state `aria-current` reports", () => {
    const { rerender } = render(<GlobalNavPill />);
    expect(screen.getByRole("navigation", { name: "주요 화면" })).toHaveAttribute(
      "data-active",
      "today",
    );

    pathname.current = "/library";
    rerender(<GlobalNavPill />);
    const nav = screen.getByRole("navigation", { name: "주요 화면" });
    expect(nav).toHaveAttribute("data-active", "browse");
    expect(screen.getByRole("link", { name: /Inbox/ })).toHaveAttribute("aria-current", "page");
  });

  it("parks the slider on a route outside the model instead of lying", () => {
    pathname.current = "/settings";
    render(<GlobalNavPill />);

    const nav = screen.getByRole("navigation", { name: "주요 화면" });
    expect(nav).toHaveAttribute("data-active", "none");
    for (const link of within(nav).getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});

/* ─────────────────────────────────────────────────────── system status entry */

describe("WorkspaceStatusButton", () => {
  it.each([
    ["healthy", "정상"],
    ["attention", "확인 필요"],
    ["failed", "실패"],
  ] as const)("names the %s state in words, not only in colour", (status, word) => {
    render(<WorkspaceStatusButton status={status} />);
    expect(
      screen.getByRole("link", { name: `설정 · 시스템 상태 ${word}, 열기` }),
    ).toBeInTheDocument();
  });

  it("carries the count in the accessible name and as a digit", () => {
    render(<WorkspaceStatusButton status="attention" count={3} />);

    const link = screen.getByRole("link", { name: "설정 · 시스템 상태 확인 필요 3건, 열기" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveTextContent("3");
  });

  it("gives every state a different glyph, so the icon is a second signal", () => {
    const glyphs = new Set<string>();

    for (const status of ["healthy", "attention", "failed"] as WorkspaceStatus[]) {
      const { container } = render(<WorkspaceStatusButton status={status} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      // lucide stamps the icon name on the element; the shape itself is what differs.
      glyphs.add(svg?.getAttribute("class") ?? "");
    }

    expect(glyphs.size).toBe(3);
  });

  it("stays a 44px target even though the painted circle is smaller", () => {
    render(<WorkspaceStatusButton status="healthy" />);
    expect(screen.getByRole("link")).toHaveClass("hit-44");
  });
});

/* ──────────────────────────────────────────────────────────────── query dock */

describe("TasteQueryDock", () => {
  it("gives the field a real, programmatic label", () => {
    render(<TasteQueryDock />);
    expect(screen.getByLabelText("Taste Query 질문 입력")).toBeInTheDocument();
  });

  it("announces that it is not wired up — it does not only imply it", () => {
    render(<TasteQueryDock />);
    const field = screen.getByLabelText("Taste Query 질문 입력");

    // 1. state on the control itself
    expect(field).toHaveAttribute("aria-disabled", "true");
    expect(field).toHaveAttribute("readonly");

    // 2. a visible Korean notice, wired to the field by `aria-describedby`
    const noticeId = field.getAttribute("aria-describedby");
    expect(noticeId).not.toBeNull();
    const notice = document.getElementById(noticeId ?? "");
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent("Taste Query는 아직 준비 중이에요");
    expect(notice).toBeVisible();

    // 3. the state chip, in the slot the reference gives to a shortcut it does not have
    expect(screen.getByText("준비 중")).toBeVisible();
  });

  it("stays focusable, so the explanation is reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<TasteQueryDock />);

    await user.tab();
    expect(screen.getByLabelText("Taste Query 질문 입력")).toHaveFocus();
  });

  it("swallows nothing the user types", async () => {
    const user = userEvent.setup();
    render(<TasteQueryDock />);
    const field = screen.getByLabelText<HTMLInputElement>("Taste Query 질문 입력");

    await user.click(field);
    await user.keyboard("오늘 저장한 것");

    expect(field.value).toBe("");
  });

  it("labels both buttons and disables them rather than faking a response", () => {
    render(<TasteQueryDock />);

    const mic = screen.getByRole("button", { name: "음성으로 질문하기 (준비 중)" });
    const send = screen.getByRole("button", { name: "질문 보내기 (준비 중)" });

    expect(mic).toBeDisabled();
    expect(send).toBeDisabled();
    // Neither is a submit button: there is no form and nothing to submit to.
    expect(mic).toHaveAttribute("type", "button");
    expect(send).toHaveAttribute("type", "button");
  });

  it("renders exactly three orb petals, all decorative", () => {
    const { container } = render(<TasteQueryDock />);
    const orb = container.querySelector('span[aria-hidden="true"]');

    expect(orb).not.toBeNull();
    expect(orb?.querySelectorAll("i")).toHaveLength(3);
    // Nothing inside the orb is announced or focusable.
    expect(orb?.querySelectorAll("a, button, [tabindex]")).toHaveLength(0);
  });
});

describe("WorkspaceQueryDock", () => {
  it.each(["/today", "/library", "/style", "/items/garden-lens", "/focus/datasette", "/system"])(
    "mounts nothing on %s",
    (path) => {
      /*
       * The floating dock is off everywhere (2026-09-28). It said `질문 입력은 아직 열리지
       * 않았어요` over the cards on the two screens where the next move is to pick an item,
       * and the Lab now has a composer that does take a question two clicks away — so the
       * read-only one contradicted it. `TasteQueryDock` is intact for when there is a
       * query path over the library.
       */
      pathname.current = path;
      const { container } = render(<WorkspaceQueryDock />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});

/* ────────────────────────────────────────────────────────────────── the frame */

describe("AppShell", () => {
  it("puts the scenic backdrop inside the frame, ahead of the bar and the content", () => {
    const { container } = render(
      <AppShell ambient="quiet" contextBar={<ContextBar profileName="Suzie" />}>
        <p>content</p>
      </AppShell>,
    );

    // The scenic art's own wrapper is the backdrop; its parent is the frame.
    const frame = container.querySelector("svg")?.closest("div")?.parentElement ?? null;
    if (frame === null) {
      throw new Error("the scenic backdrop is not inside the frame");
    }

    // Backdrop first, then the bar, then the viewport — the paint order the z-index
    // tokens assume.
    expect(frame.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(frame.children[1]?.tagName).toBe("HEADER");
    expect(within(frame).getByRole("main")).toHaveTextContent("content");
  });

  it("mounts no dock by default", () => {
    // `WorkspaceQueryDock` is still the default slot; it simply renders nothing while
    // there is no query path over the library.
    render(<AppShell>content</AppShell>);
    expect(screen.queryByLabelText("Taste Query 질문 입력")).toBeNull();
  });

  it("lets a caller override the dock, including with nothing", () => {
    render(
      <AppShell dock={null}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.queryByLabelText("Taste Query 질문 입력")).toBeNull();
  });

  it("keeps exactly one main landmark", () => {
    render(
      <AppShell contextBar={<ContextBar profileName="Suzie" />}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
