import {
  MusicItemCardModelSchema,
  MusicServiceSchema,
  buildMusicSearchUrl,
} from "@taste-inbox/shared";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MusicItemCard, MusicShelfCard } from "@/components/music/MusicItemCard";
import { MockRepository } from "@/lib/mock/repository";
import { findActiveDestination } from "@/lib/navigation/routes";

const repository = new MockRepository();

describe("music search hand-off", () => {
  it("builds a plain search rather than a resolved track id", () => {
    // A search the user completes cannot save the wrong song. This is the whole reason
    // the first release hands off instead of writing.
    expect(buildMusicSearchUrl("Example Artist Petrichor", "youtube_music")).toBe(
      "https://music.youtube.com/search?q=Example%20Artist%20Petrichor",
    );
  });

  it("encodes Korean queries", () => {
    const url = buildMusicSearchUrl("우산 없이", "youtube_music");
    expect(url.startsWith("https://music.youtube.com/search?q=")).toBe(true);
    expect(decodeURIComponent(url.split("q=")[1] ?? "")).toBe("우산 없이");
  });

  it("has exactly one destination, so a link can never be mislabelled", () => {
    // The card's link label is a fixed Korean string. A second service in the union
    // would let a producer emit a Spotify href under a YouTube Music label.
    expect(MusicServiceSchema.options).toEqual(["youtube_music"]);
  });
});

describe("music repository", () => {
  it("returns validated items", async () => {
    const page = await repository.listMusicItems();
    for (const item of page.items) {
      expect(() => MusicItemCardModelSchema.parse(item)).not.toThrow();
    }
  });

  it("behaves as an inbox, hiding what the user already dealt with", async () => {
    const inbox = await repository.listMusicItems();
    const all = await repository.listMusicItems({ includeHandled: true });

    expect(inbox.items.every((item) => item.handledAt === null)).toBe(true);
    expect(all.items.length).toBeGreaterThan(inbox.items.length);
  });

  it("takes the same source filter the other two boards take", async () => {
    // Never rendered on `/music` — the board is entirely Instagram, so the facet cannot
    // narrow it. It exists for `/library`, which applies one `?source=` across all three
    // lists; a list that ignored it would answer `?source=github` with Instagram Reels.
    const instagram = await repository.listMusicItems({ source: ["instagram"] });
    const github = await repository.listMusicItems({ source: ["github"] });

    expect(instagram.items.length).toBeGreaterThan(0);
    expect(github.items).toEqual([]);
  });

  it("narrows by source without giving up the inbox default", async () => {
    // Two independent narrowings. `?source=` must not quietly reveal rows the user cleared.
    const page = await repository.listMusicItems({ source: ["instagram"] });
    expect(page.items.every((item) => item.handledAt === null)).toBe(true);
  });

  it("includes a Reel with no extractable candidates", async () => {
    // The case the design has to survive: the song list is only on screen or spoken.
    const page = await repository.listMusicItems();
    expect(page.items.some((item) => item.candidates.length === 0)).toBe(true);
  });

  it("includes a multi-song Reel, since that is the genre in question", async () => {
    const page = await repository.listMusicItems();
    expect(page.items.some((item) => item.candidates.length > 1)).toBe(true);
  });

  it("never writes anywhere: every candidate action is a search URL", async () => {
    const page = await repository.listMusicItems({ includeHandled: true });
    for (const item of page.items) {
      for (const candidate of item.candidates) {
        expect(candidate.searchUrl).toMatch(/^https:\/\/music\.youtube\.com\//);
        expect(candidate.searchUrl).toContain("search");
      }
    }
  });
});

describe("MusicItemCard", () => {
  async function first() {
    const page = await repository.listMusicItems();
    return page.items[0]!;
  }

  it("lists every recommended song", async () => {
    render(<MusicItemCard item={await first()} />);
    const list = screen.getByRole("list", { name: "추천된 곡" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  });

  it("shows the observed text beside a resolved track", async () => {
    // DESIGN.md §3.5 — the fact and the inference must stay distinguishable.
    render(<MusicItemCard item={await first()} />);
    expect(screen.getByText("Example Artist — Petrichor")).toBeInTheDocument();
    // Three of the four candidates resolved, so three carry their observed string.
    expect(screen.getAllByText(/릴스에 적힌 원문/)).toHaveLength(3);
    expect(screen.getByText(/Fourth Example - Quiet Hours \(sped up\)/)).toBeInTheDocument();
  });

  it("grades a sped-up edit as a different version, not an exact match", async () => {
    render(<MusicItemCard item={await first()} />);
    expect(screen.getByLabelText("다른 버전")).toHaveTextContent("Different version");
  });

  it("falls back to the raw text when nothing was resolved", async () => {
    render(<MusicItemCard item={await first()} />);
    expect(screen.getByText("Third Example - 우산 없이")).toBeInTheDocument();
    expect(screen.getByLabelText("확인 필요")).toBeInTheDocument();
  });

  it("opens hand-off links in a new tab, safely", async () => {
    render(<MusicItemCard item={await first()} />);
    for (const link of screen.getAllByRole("link", { name: /YouTube Music에서 찾기/ })) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("stays useful when no candidate could be extracted", async () => {
    const page = await repository.listMusicItems();
    const bare = page.items.find((item) => item.candidates.length === 0)!;
    render(<MusicItemCard item={bare} />);

    expect(screen.getByText(/찾지 못했어요/)).toBeInTheDocument();
    // The Reel itself is still reachable, so the card still stops the forgetting.
    expect(screen.getByRole("link", { name: /릴스 열기/ })).toHaveAttribute(
      "href",
      bare.source.originalUrl,
    );
  });

  it("says which of the three empty states it is in", async () => {
    // These used to share one sentence about the caption, which was wrong in two of them.
    // A cover that was read and found blank is a different answer from one nobody has
    // looked at, and the user is the one who decides whether to open the Reel.
    const page = await repository.listMusicItems();
    const bare = page.items.find((item) => item.candidates.length === 0)!;

    const { rerender } = render(<MusicItemCard item={bare} />);
    expect(screen.getByText(/아직 곡을 찾지 못했어요/)).toBeInTheDocument();

    rerender(<MusicItemCard item={{ ...bare, coverCheckedAt: "2026-08-09T11:00:00Z" }} />);
    expect(screen.getByText(/표지에 글자가 없고/)).toBeInTheDocument();

    rerender(
      <MusicItemCard
        item={{ ...bare, coverCheckedAt: "2026-08-09T11:00:00Z", coverText: "오늘의 추천곡" }}
      />,
    );
    expect(screen.getByText(/곡 이름 형태는 아니었어요/)).toBeInTheDocument();
  });

  it("shows what was read off the cover as a reading, not as the image's text", async () => {
    // The recogniser misreads — measured: `Lullaby / JayDon, Paradise` came back as
    // `ullaby / Jay pon, Paraoise`. The heading says 읽은 글자 so the user knows who to
    // trust when the two disagree.
    const page = await repository.listMusicItems();
    const bare = page.items.find((item) => item.candidates.length === 0)!;

    render(
      <MusicItemCard
        item={{ ...bare, coverCheckedAt: "2026-08-09T11:00:00Z", coverText: "감성 팝송 플리" }}
      />,
    );
    expect(screen.getByText(/표지에서 읽은 글자/)).toBeInTheDocument();
    expect(screen.getByText("감성 팝송 플리")).toBeInTheDocument();
  });

  it("offers a direct link to whatever the Reel itself pointed at", async () => {
    // "소스·보드 상관없이 바로가기" — a link the post contained is a click, not a hop
    // through the post.
    const page = await repository.listMusicItems();
    const bare = page.items.find((item) => item.candidates.length === 0)!;

    render(
      <MusicItemCard
        item={{
          ...bare,
          links: [
            {
              id: "l1",
              url: "https://open.example.com/playlist/1",
              label: "open.example.com",
              kind: "outbound",
              origin: "post",
              via: null,
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /open\.example\.com/ })).toHaveAttribute(
      "href",
      "https://open.example.com/playlist/1",
    );
  });

  it("renders the caption as plain text", async () => {
    // Untrusted third-party text: displayed, never parsed as markup.
    const { container } = render(<MusicItemCard item={await first()} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/비 오는 날 듣기 좋은 노래 4곡/)).toBeInTheDocument();
  });
});

describe("MusicShelfCard", () => {
  async function first() {
    const page = await repository.listMusicItems();
    return page.items[0]!;
  }

  it("replaces the top category picker with the shared original-post link", async () => {
    const item = await first();
    render(<MusicShelfCard item={item} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Instagram 저장/ })).toHaveAttribute(
      "href",
      item.source.originalUrl,
    );
    expect(screen.getByRole("link", { name: /Instagram 저장/ }).className).toContain("badge");
  });

  it("puts the first track on the sleeve and keeps the whole list inside", async () => {
    render(<MusicShelfCard item={await first()} />);

    expect(
      screen.getByRole("heading", { level: 3, name: /Example Artist — Petrichor/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("4곡")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "추천된 곡" })).getAllByRole("listitem"),
    ).toHaveLength(4);
  });

  it("keeps an unidentified Reel in the same shelf grammar", async () => {
    const page = await repository.listMusicItems();
    const bare = page.items.find((item) => item.candidates.length === 0)!;

    render(<MusicShelfCard item={bare} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "곡 정보 확인 필요" }),
    ).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /릴스 열기/ })).toHaveAttribute(
      "href",
      bare.source.originalUrl,
    );
  });

  it("uses the same two-three-four column rhythm as Trends", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(here, "../src/components/collection/Board.module.css"), "utf8");
    const music = css.slice(css.indexOf(".musicBoard"), css.indexOf("/* Rail beside board"));

    expect(music).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(music).toMatch(/repeat\(3, minmax\(0, 1fr\)\)/);
    expect(music).toMatch(/repeat\(4, minmax\(0, 1fr\)\)/);
  });
});

describe("music navigation", () => {
  it("keeps Music inside Browse rather than adding a fourth destination", () => {
    // docs/DECISIONS.md 2026-08-08 — the pill stays at two items.
    expect(findActiveDestination("/music")?.id).toBe("browse");
  });
});
