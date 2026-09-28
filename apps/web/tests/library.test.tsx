import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LibraryPage from "@/app/(workspace)/library/page";
import { MOCK_AI_ITEMS } from "@/lib/mock/seed";

/**
 * The Inbox — one list since 2026-09-28.
 *
 * It used to merge five boards with three card models; the boards went with Instagram. What
 * these tests hold is what is left: every item on one card, newest first as the repository
 * gave them, narrowed by kind, source and day from the URL.
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

/** Every card's item id, in the order the Inbox put them on screen. */
function order(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('a[href^="/items/"]')].map((link) =>
    new URL(link.getAttribute("href") ?? "", "https://taste-inbox.local").pathname.replace(
      "/items/",
      "",
    ),
  );
}

describe("the Inbox", () => {
  it("offers direct link input locally but not on the remote read-only view", async () => {
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

  it("shows every collected item, each with the way into the Lab", async () => {
    const { container } = await renderLibrary();

    expect(order(container)).toEqual(MOCK_AI_ITEMS.map((item) => item.id));
    expect(screen.getAllByRole("link", { name: /Open in Lab/ })).toHaveLength(MOCK_AI_ITEMS.length);
  });

  it("names every kind in English, the Inbox's own nouns", async () => {
    const { container } = await renderLibrary();
    const board = container.querySelector("ul[class*='board']");
    expect(board).not.toBeNull();
    for (const kind of ["Repo", "Paper", "Model", "Dataset", "Space"]) {
      expect(within(board as HTMLElement).getAllByText(kind).length).toBeGreaterThan(0);
    }
  });

  it("has no board to pick and nothing from the Instagram era", async () => {
    const { container } = await renderLibrary();
    expect(container.querySelector("select")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Browse by type" })).not.toBeInTheDocument();
    for (const gone of ["Style", "Music", "Places", "Instagram", "Threads", "LinkedIn"]) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  it("narrows by kind, from the URL", async () => {
    const { container } = await renderLibrary({ kind: "paper" });
    expect(order(container)).toEqual(
      MOCK_AI_ITEMS.filter((item) => item.kind === "paper").map((item) => item.id),
    );
  });

  it("says so rather than showing an unfiltered Inbox when a filter matches nothing", async () => {
    // `?source=web` is a real value in the schema with no items behind it — the difference
    // between "you have nothing saved" and "this filter has nothing" is a real one.
    await renderLibrary({ source: "web" });
    expect(screen.getByText("이 조건에 맞는 항목이 없어요")).toBeInTheDocument();
  });

  it("counts on the header what it actually rendered, filtered or not", async () => {
    const views: readonly Record<string, string>[] = [{}, { source: "github" }];
    for (const params of views) {
      const { container, unmount } = await renderLibrary(params);
      const rendered = order(container).length;
      const meta = screen.getByRole("list", { name: "보드 상태" });
      expect(within(meta).getByText(`${rendered.toLocaleString("ko-KR")}개`)).toBeInTheDocument();
      unmount();
    }
  });

  it("offers its sources as one single-select group", async () => {
    await renderLibrary();
    const rail = screen.getByRole("navigation", { name: "Inbox 필터" });

    const github = within(rail).getByRole("link", { name: /GitHub/ });
    expect(github).toHaveAttribute("href", "/library?source=github");
  });

  it("remembers the filtered view on the way to an item", async () => {
    const { container } = await renderLibrary({ source: "huggingface" });
    const first = container.querySelector('a[href^="/items/"]');
    expect(first?.getAttribute("href")).toContain(
      `from=${encodeURIComponent("/library?source=huggingface")}`,
    );
  });
});
