import type { AIItemCardModel, StyleItemCardModel } from "@taste-inbox/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Archive } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AIItemCard } from "@/components/ai/AIItemCard";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { browseCardSize } from "@/components/collection/BrowseCard";
import { CollectionRail } from "@/components/collection/CollectionRail";
import type { FilterGroup } from "@/components/collection/FilterChipRow";
import { CollectedImage } from "@/components/media/CollectedImage";
import { StyleItemCard } from "@/components/style/StyleItemCard";

/**
 * The three Browse boards render items that have been collected but never enriched.
 *
 * These tests hold the line DESIGN.md §3.5 draws: a card may show what was observed, and
 * must not dress an unknown up as a finding. They are written against the unresolved
 * variant on purpose — today it is 126 items out of 126, so it is the board's real
 * appearance, not a fallback.
 */

const SOURCE = {
  platform: "instagram",
  label: "Instagram Saved · Fashion",
  originalUrl: "https://www.instagram.com/reel/DAaaaaaaaaa/",
  author: "sample_owner",
  actionType: "save",
  firstSeenAt: "2026-08-08T04:05:41.000Z",
} as const;

function photo(role: string, alt: string) {
  return {
    id: `DAaaaaaaaaa-${role}`,
    type: "image" as const,
    src: `https://scontent.cdninstagram.com/v/t51/${role}.jpg`,
    width: 640,
    height: 800,
    alt,
  };
}

function styleItem(overrides: Partial<StyleItemCardModel> = {}): StyleItemCardModel {
  return {
    id: "DAaaaaaaaaa",
    descriptor: "여름에 이렇게 입고 나갔다가",
    caption: "여름에 이렇게 입고 나갔다가\n#여름코디",
    checkedAt: null,
    source: SOURCE,
    tags: [],
    links: [],
    author: null,
    media: [photo("thumbnail", "저장한 게시물의 표지 이미지")],
    ...overrides,
  };
}

function aiItem(overrides: Partial<AIItemCardModel> = {}): AIItemCardModel {
  return {
    id: "DAaaaaaaaaa",
    kind: "post",
    title: "요즘 바이브코딩 이렇게 합니다",
    summary: "저장해 둔 게시물의 캡션 본문입니다.",
    status: "unknown",
    whyItMatters: null,
    peakMemoryGb: null,
    diskGb: null,
    supportsArm64: null,
    compatibility: null,
    checkedAt: null,
    source: { ...SOURCE, label: "Instagram Saved · AI" },
    tags: [],
    links: [],
    preview: {
      id: "DAaaaaaaaaa-cover",
      type: "video_frame",
      src: "https://scontent.cdninstagram.com/v/t51/thumb.jpg",
      width: 640,
      height: 800,
      alt: "저장한 릴스의 표지 이미지",
    },
    ...overrides,
  } as AIItemCardModel;
}

describe("BoardHeader", () => {
  it("says the items were really collected", () => {
    render(<BoardHeader title="Style" lead="l" total={76} collected unenrichedNote="n" />);
    expect(screen.getByText("수집됨")).toBeInTheDocument();
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
  });

  it("says so when the board is showing seed data instead", () => {
    // A board of committed fixtures and a board of the user's own saves look identical
    // otherwise, and judging the product on the wrong one is a real error.
    render(<BoardHeader title="Style" lead="l" total={4} collected={false} unenrichedNote="n" />);
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
  });

  it("does not rely on colour alone to say which", () => {
    const { rerender } = render(
      <BoardHeader title="Style" lead="l" total={1} collected unenrichedNote="n" />,
    );
    expect(screen.getByLabelText("실제로 수집한 항목입니다")).toBeInTheDocument();
    rerender(<BoardHeader title="Style" lead="l" total={1} collected={false} unenrichedNote="n" />);
    expect(screen.getByLabelText("예시 데이터입니다")).toBeInTheDocument();
  });

  it("explains that nothing has been enriched, while there is anything to explain", () => {
    const note = "아직 상품을 확인하지 않았어요.";
    const { rerender } = render(
      <BoardHeader title="Style" lead="l" total={76} collected unenrichedNote={note} />,
    );
    expect(screen.getByText(note)).toBeInTheDocument();

    rerender(<BoardHeader title="Style" lead="l" total={0} collected unenrichedNote={note} />);
    // On an empty board the notice would describe items that are not there.
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it("allows a board to omit the explanatory strip", () => {
    render(<BoardHeader title="Saved Items" lead="l" total={4} collected />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("keeps the English board name marked as English for screen readers", () => {
    render(<BoardHeader title="Style" lead="l" total={1} collected unenrichedNote="n" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
  });
});

describe("StyleItemCard", () => {
  it("makes no claim about a product", () => {
    // Every product affordance went with the decision that this board never resolves one.
    // A match pill or an empty price row left behind would keep promising an answer that
    // is no longer coming (docs/DECISIONS.md, 2026-08-09).
    const { container } = render(<StyleItemCard item={styleItem()} />);
    const text = container.textContent;

    expect(text).not.toContain("아직 상품을 확인하지 않았어요.");
    expect(screen.queryByText(/Exact match|Not identified|확인 필요/)).not.toBeInTheDocument();
    // A number followed by a currency mark, rather than the bare characters — "원본 보기"
    // legitimately contains 원.
    expect(text).not.toMatch(/[\d,]+\s*(원|₩)/);
    expect(text).not.toMatch(/[₩$]\s*[\d,]+/);
    expect(text).not.toMatch(/\d+\s*곳|판매처|구매처/);
  });

  it("shows every photo the post contained, in the order it was posted", () => {
    // The whole point of the change: a carousel used to lose everything past its cover at
    // capture time, so all 126 collected items held exactly one image.
    render(
      <StyleItemCard
        item={styleItem({
          media: [
            photo("thumbnail", "첫 번째 사진"),
            photo("image_02", "두 번째 사진"),
            photo("image_03", "세 번째 사진"),
          ],
        })}
      />,
    );

    const gallery = screen.getByRole("list", { name: "게시물 사진 3장" });
    expect(
      within(gallery)
        .getAllByRole("img")
        .map((image) => image.getAttribute("alt")),
    ).toEqual(["첫 번째 사진", "두 번째 사진", "세 번째 사진"]);
  });

  it("renders one photo through the same gallery as many", () => {
    render(<StyleItemCard item={styleItem()} />);
    const gallery = screen.getByRole("list", { name: "게시물 사진 1장" });
    expect(within(gallery).getAllByRole("img")).toHaveLength(1);
    // A count of one and a tab stop with nothing to scroll are both furniture.
    expect(gallery).not.toHaveAttribute("tabindex");
    expect(screen.queryByText("1장")).not.toBeInTheDocument();
  });

  it("says how many photos there are, and lets a keyboard reach them", () => {
    render(
      <StyleItemCard item={styleItem({ media: [photo("thumbnail", "a"), photo("2", "b")] })} />,
    );
    expect(screen.getByText("2장")).toBeInTheDocument();
    // A scrollable region no keyboard can enter is a WCAG 2.1.1 failure.
    expect(screen.getByRole("list", { name: "게시물 사진 2장" })).toHaveAttribute("tabindex", "0");
  });

  it("survives an item with no photo at all", () => {
    render(<StyleItemCard item={styleItem({ media: [] })} />);
    // The caption and the link are still the card; the frame says what is missing rather
    // than collapsing the layout.
    expect(screen.getByRole("img", { name: "사진이 없는 게시물" })).toBeInTheDocument();
    expect(screen.getByText(/여름에 이렇게 입고 나갔다가/)).toBeInTheDocument();
  });

  it("shows the caption, hashtags included, as the author wrote it", () => {
    render(<StyleItemCard item={styleItem({ tags: ["#여름코디", "#ootd"] })} />);
    expect(screen.getByText(/여름에 이렇게 입고 나갔다가/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "해시태그" })).getByText("#ootd")).toBeVisible();
  });

  it("renders the caption as text and never as markup", () => {
    const { container } = render(
      <StyleItemCard item={styleItem({ caption: "<img src=x onerror=alert(1)>" })} />,
    );
    // Captions are third-party text; they are displayed, never parsed.
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("keeps the whole of a long caption and offers to open it", () => {
    // Measured over the 76 collected fashion posts: the median caption is 117 characters
    // and 21 run past the clamp, up to 943.
    //
    // The in-place disclosure is gone with the move to the Saved Items card: a card on a
    // span grid cannot double its own height without shoving its neighbours down. What has
    // to survive is the guarantee behind it — the caption is never cut, and there is a
    // named way to read the rest.
    const long = "가".repeat(600) + "끝";
    render(<StyleItemCard item={styleItem({ caption: long })} />);

    // Present in the DOM, not merely promised: the clamp is CSS, so the text is all here.
    for (const node of screen.getAllByText(long)) {
      expect(node.textContent).toHaveLength(601);
    }
    expect(screen.getByRole("link", { name: "여름에 이렇게 입고 나갔다가" })).toHaveAttribute(
      "href",
      "/items/DAaaaaaaaaa",
    );
  });

  it("shows a post with no caption without an empty line where words would be", () => {
    const { container } = render(<StyleItemCard item={styleItem({ caption: "" })} />);
    // The title is the caption's lead line, so an empty caption leaves the card with a
    // heading and nothing beneath it. Every paragraph that is rendered says something: a
    // post without words is a normal post, not a missing value holding a blank line open.
    for (const paragraph of container.querySelectorAll("p")) {
      expect(paragraph.textContent.trim()).not.toBe("");
    }
    expect(screen.getByRole("link", { name: /원본 보기/ })).toBeInTheDocument();
  });

  it("offers only the action it can actually perform", () => {
    render(<StyleItemCard item={styleItem()} />);
    // Two links, both real destinations: the post on Instagram, and this item's own page.
    // Nothing names an action this product performs — there is no shopping search, no
    // price check and no run.
    const link = screen.getByRole("link", { name: /원본 보기/ });
    expect(link).toHaveTextContent("원본 보기");
    expect(link).toHaveAttribute("href", SOURCE.originalUrl);
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(within(link).getByText("(새 탭에서 열림)")).toBeInTheDocument();

    expect(screen.getAllByRole("link").map((node) => node.getAttribute("href"))).toEqual([
      SOURCE.originalUrl,
      "/items/DAaaaaaaaaa",
    ]);
  });

  it("floats the signal that put the item here over the picture", () => {
    // `.media-source` in the reference is a static chip reading "Instagram Saved". The
    // product already had the permalink, so the chip is the link — and it says the action
    // as well as the platform, which is the whole input to this product (CLAUDE.md §1) and
    // was collected but never shown anywhere until now.
    render(<StyleItemCard item={styleItem()} />);
    const badge = screen.getByRole("link", { name: /원본 보기/ });

    expect(badge).toHaveTextContent("Instagram 저장");
    expect(badge).toHaveAttribute("target", "_blank");
    // WCAG 2.5.3: the visible text has to be part of the accessible name, not replaced.
    expect(badge).toHaveAccessibleName(expect.stringContaining("Instagram 저장"));
  });

  it("names the platform alone when the action was never recorded", () => {
    render(<StyleItemCard item={styleItem({ source: { ...SOURCE, actionType: null } })} />);
    const badge = screen.getByRole("link", { name: /원본 보기/ });
    expect(badge).toHaveTextContent("Instagram");
    expect(badge).not.toHaveTextContent("Instagram 저장");
  });

  it("says whether anything has looked at the item yet, in words", () => {
    // The footer slot the reference filled with "Exact 92%" — a product match this board
    // does not make (docs/DECISIONS.md, 2026-08-09). What goes there is a fact about this
    // product's own processing, and it is never colour alone (CLAUDE.md §6).
    const { rerender } = render(<StyleItemCard item={styleItem()} />);
    expect(screen.getByText("확인 전")).toBeInTheDocument();
    expect(screen.getByLabelText("아직 확인하지 않은 항목입니다")).toBeInTheDocument();

    rerender(<StyleItemCard item={styleItem({ checkedAt: "2026-08-09T10:00:00Z" })} />);
    expect(screen.getByText("확인함")).toBeInTheDocument();
    expect(screen.getByLabelText("확인을 마친 항목입니다")).toBeInTheDocument();
  });

  it("greens the first hashtag only, and never makes the colour mean anything", () => {
    // `tone: i === 0 ? 'green' : 'neutral'` in the reference — emphasis, not a second kind
    // of tag. Nothing about the row depends on which one is tinted.
    render(<StyleItemCard item={styleItem({ tags: ["#여름코디", "#ootd", "#daily"] })} />);
    const tags = within(screen.getByRole("list", { name: "해시태그" })).getAllByRole("listitem");

    expect(tags.map((tag) => tag.textContent)).toEqual(["#여름코디", "#ootd", "#daily"]);
    expect(tags[0]?.className).not.toBe(tags[1]?.className);
  });
});

describe("AIItemCard, unresolved", () => {
  it("labels the link by where it goes, not by the status action", () => {
    // AI_STATUS.unknown.primaryAction is 확인하기 — a check this product cannot run on an
    // Instagram post, and the anchor only ever opens the permalink. It moved from a footer
    // button to the chip floating on the media block; the label did not change.
    render(<AIItemCard item={aiItem()} />);
    const link = screen.getByRole("link", { name: /원본 게시물 보기/ });
    expect(link).toHaveAttribute("href", SOURCE.originalUrl);
    expect(link).toHaveTextContent("원본 게시물 보기");
    expect(link).not.toHaveTextContent("확인하기");
  });

  it("names the repository action for a repository", () => {
    render(
      <AIItemCard
        item={aiItem({
          kind: "repo",
          source: { ...SOURCE, platform: "github", label: "GitHub", author: "anthropics" },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /저장소 열기/ })).toHaveAttribute(
      "href",
      SOURCE.originalUrl,
    );
  });

  it("says what kind of thing it is, in the eyebrow the reference draws", () => {
    // `.browse-type-row` — the reference prints a literal `AI Tool` / `Research`; ours is
    // `AIItemKindSchema`, which is the distinction the product can actually make.
    const { rerender } = render(<AIItemCard item={aiItem()} />);
    expect(screen.getByText("게시물")).toBeInTheDocument();

    rerender(<AIItemCard item={aiItem({ kind: "repo" })} />);
    expect(screen.getByText("저장소")).toBeInTheDocument();
  });

  it("keeps the outbound links the post carried", () => {
    // "소스·보드 상관없이 바로가기": a link the post contained is a click, not a hop
    // through the post.
    render(
      <AIItemCard
        item={aiItem({
          links: [
            {
              id: "l1",
              url: "https://github.com/example/repo",
              label: "github.com",
              kind: "artifact",
              origin: "post",
              via: null,
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /github\.com/ })).toHaveAttribute(
      "href",
      "https://github.com/example/repo",
    );
  });

  it("makes no claim about running the thing", () => {
    // Every execution affordance went with the sandbox runner. A pill or a meter left in
    // its `unknown` state would keep promising an answer that is no longer coming.
    render(<AIItemCard item={aiItem()} />);
    expect(screen.queryByText("아직 확인하지 않음")).not.toBeInTheDocument();
    expect(screen.queryByText(/Ready|Needs token|Not checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/예상 최대 메모리/)).not.toBeInTheDocument();
  });

  it("renders hashtags as evidence when they exist", () => {
    render(<AIItemCard item={aiItem({ tags: ["#바이브코딩", "#클로드코드"] })} />);
    expect(screen.getByText("#바이브코딩")).toBeInTheDocument();
  });
});

describe("CollectedImage", () => {
  it("shows the thumbnail while it loads", () => {
    render(<CollectedImage src="https://cdn.example/x.jpg" alt="표지" />);
    expect(screen.getByAltText("표지")).toBeInTheDocument();
  });

  it("says the original is gone once the signed URL expires", () => {
    // Instagram's CDN URLs expire within days and the media cache does not exist yet, so
    // this is the state the boards end up in, not a rare edge.
    render(<CollectedImage src="https://cdn.example/expired.jpg" alt="표지" />);
    fireEvent.error(screen.getByAltText("표지"));

    expect(screen.getByText("원본 이미지를 더 이상 불러올 수 없어요")).toBeInTheDocument();
    expect(screen.queryByAltText("표지")).not.toBeInTheDocument();
    // The box keeps an accessible name, so the card does not become a silent gap.
    expect(screen.getByRole("img", { name: "표지 (불러오지 못함)" })).toBeInTheDocument();
  });
});

describe("post body", () => {
  it("shows a short post whole, with no control to reveal nothing", () => {
    render(<AIItemCard item={aiItem({ summary: "짧은 본문입니다." })} />);
    expect(screen.getByText("짧은 본문입니다.")).toBeInTheDocument();
    expect(screen.queryByText("전문 보기")).not.toBeInTheDocument();
  });

  it("keeps the whole of a long post and offers to open it", () => {
    // The API used to cut at 400 characters. Four of the five collected LinkedIn posts
    // run past that — 455 to 2678 — so most of each was gone before the card existed.
    const long = "가".repeat(600) + "끝";
    render(<AIItemCard item={aiItem({ summary: long })} />);

    // Present in the DOM, not merely promised: the clamp is CSS, so the text is all here.
    for (const node of screen.getAllByText(long)) {
      expect(node.textContent).toHaveLength(601);
    }
    // And there is a named way to read the rest of it.
    expect(screen.getByRole("link", { name: "요즘 바이브코딩 이렇게 합니다" })).toHaveAttribute(
      "href",
      "/items/DAaaaaaaaaa",
    );
  });

  it("names the route to the rest by its destination, never by a changing label", () => {
    // This replaced an in-place disclosure whose visible label swapped between 전문 보기
    // and 접기. That pattern had to keep two labels in sync, because a fixed accessible
    // name over a control whose visible text changes is a WCAG 2.5.3 failure. A link has
    // one name and one destination, so the failure is not representable.
    render(<AIItemCard item={aiItem({ summary: "나".repeat(600) })} />);

    const toItem = screen.getByRole("link", { name: "요즘 바이브코딩 이렇게 합니다" });
    expect(toItem).toHaveAccessibleName("요즘 바이브코딩 이렇게 합니다");
    expect(screen.queryByText("전문 보기")).not.toBeInTheDocument();
    expect(screen.queryByText("접기")).not.toBeInTheDocument();
  });
});

describe("StyleItemCard, the purchase route", () => {
  const shop = (id: string, label: string, url: string) => ({
    id,
    url,
    label,
    kind: "shop" as const,
    origin: "profile" as const,
    via: null,
  });

  const withAuthor = () =>
    styleItem({
      author: {
        handle: "example_closet",
        displayName: "예시클로젯",
        links: [
          shop("s1", "예시클로젯 바로가기", "https://shop.example.kr/"),
          shop("s2", "international shipping", "https://example.cafe24.example.com/shop6/m"),
        ],
        mentions: ["example.brand"],
        checkedAt: "2026-08-09T18:00:00Z",
      },
    });

  it("shows the name beside the handle once the profile has been read", () => {
    // The post only ever carried `example_closet`. The name is what a person recognises,
    // and 60 of the board's 61 accounts have one.
    render(<StyleItemCard item={withAuthor()} />);
    expect(screen.getByText("예시클로젯 (@example_closet)")).toBeInTheDocument();
  });

  it("offers every shop under the author's own titles", () => {
    // The titles are the point: the bare hosts say neither which storefront is domestic
    // nor which ships abroad.
    render(<StyleItemCard item={withAuthor()} />);
    expect(screen.getByRole("link", { name: /예시클로젯 바로가기/ })).toHaveAttribute(
      "href",
      "https://shop.example.kr/",
    );
    expect(screen.getByRole("link", { name: /international shipping/ })).toBeInTheDocument();
  });

  it("labels a shop as coming from the profile, not from this post", () => {
    // A weaker claim about the photo than a link the post itself carried — and it holds
    // for every shop on the card, not just the first.
    render(<StyleItemCard item={withAuthor()} />);
    expect(screen.getAllByRole("link", { name: /프로필/ })).toHaveLength(2);
  });

  it("falls back to the handle when the profile has not been read", () => {
    render(<StyleItemCard item={styleItem({ author: null })} />);
    expect(screen.queryByText("작성자의 판매처")).not.toBeInTheDocument();
  });

  it("renders nothing for an account that publishes no shop", () => {
    const item = withAuthor();
    render(
      <StyleItemCard
        item={{ ...item, author: { ...item.author!, links: [], displayName: null } }}
      />,
    );
    expect(screen.queryByText("작성자의 판매처")).not.toBeInTheDocument();
    expect(screen.getByText("@example_closet")).toBeInTheDocument();
  });
});

describe("CollectionRail", () => {
  const COUNTS = { ai: 8, style: 76, music: 3, places: 0, none: 0 } as const;

  const SOURCES = [{ platform: "instagram", label: "Instagram", count: 76 }] as const;

  const KIND_GROUP: readonly FilterGroup[] = [
    {
      key: "kind",
      legend: "종류",
      options: [
        { value: "repo", label: "저장소", count: 3 },
        { value: "post", label: "게시물", count: 5 },
      ],
    },
  ];

  it("is still there when no facet can separate the board", () => {
    // The whole reason the rail changed. `/style` has 76 items and every one of them is
    // from Instagram, so no facet can narrow anything — the old rail returned null, the
    // board became the only grid item, landed in an `auto` track sized to a grid of `1fr`
    // columns, and rendered 2px wide with 76 cards in the DOM.
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={SOURCES}
        groups={[]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Inbox 필터" })).toBeInTheDocument();
  });

  it("counts every board, and says the number in the accessible name", () => {
    // The counts are real — the same `getBoardCounts()` the mode strip already uses — and
    // they are readable when the rail is collapsed to a 68px glyph column, where the
    // visible number is not rendered at all (DESIGN.md §11.2).
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={SOURCES}
        groups={[]}
      />,
    );

    expect(screen.getByRole("link", { name: "All 87개" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "Trends 8개" })).toHaveAttribute("href", "/trends");
    expect(screen.getByRole("link", { name: "Style 76개" })).toHaveAttribute("href", "/style");
    expect(screen.getByRole("link", { name: "Music 3개" })).toHaveAttribute("href", "/music");
  });

  it("marks the board the user is on", () => {
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={SOURCES}
        groups={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "Style 76개" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Trends 8개" })).not.toHaveAttribute("aria-current");
  });

  it("lists a source that cannot narrow the board as a count, not as a control", () => {
    // A filter that always returns the whole board reads as "no matches", which is a claim
    // about the items rather than about the product (DESIGN.md §3.5).
    render(
      <CollectionRail
        pathname="/style"
        params={{}}
        counts={COUNTS}
        sources={SOURCES}
        groups={[]}
      />,
    );

    expect(screen.getByText("Instagram")).toBeInTheDocument();
    expect(screen.getByText("76개")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Instagram/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Instagram/ })).not.toBeInTheDocument();
  });

  it("offers a source as a filter as soon as it can narrow something", () => {
    const sourceGroup: readonly FilterGroup[] = [
      {
        key: "source",
        legend: "출처",
        options: [
          { value: "github", label: "GitHub", count: 2 },
          { value: "instagram", label: "Instagram", count: 6 },
        ],
      },
    ];
    render(
      <CollectionRail
        pathname="/trends"
        params={{}}
        counts={COUNTS}
        sources={[
          { platform: "github", label: "GitHub", count: 2 },
          { platform: "instagram", label: "Instagram", count: 6 },
        ]}
        groups={sourceGroup}
      />,
    );

    // The filter, not the count list — a source is never listed twice.
    expect(screen.getByRole("link", { name: "GitHub 2개" })).toHaveAttribute(
      "href",
      "/trends?source=github",
    );
    expect(screen.getAllByText("Instagram")).toHaveLength(1);
  });

  it("keeps the facet rows the board can actually use", () => {
    render(
      <CollectionRail
        pathname="/trends"
        params={{ kind: "repo" }}
        counts={COUNTS}
        sources={[]}
        groups={KIND_GROUP}
      />,
    );

    expect(screen.getByRole("link", { name: "저장소 3개, 선택됨" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "게시물 5개" })).toBeInTheDocument();
    // The selected row is the way back: clicking it again drops the group entirely. That
    // is what replaced the "필터 지우기" row this panel used to end with.
    expect(screen.getByRole("link", { name: "저장소 3개, 선택됨" })).toHaveAttribute(
      "href",
      "/trends",
    );
  });

  it("only renders a rail action that has somewhere to go", () => {
    // The reference's `Connections` and `Archived` rows have no route in this product. The
    // row shape is ported; `/music` fills it with the archive it already had.
    const { rerender } = render(
      <CollectionRail pathname="/music" params={{}} counts={COUNTS} sources={[]} groups={[]} />,
    );
    expect(screen.queryByRole("link", { name: /Connections|Archived/ })).not.toBeInTheDocument();

    rerender(
      <CollectionRail
        pathname="/music"
        params={{}}
        counts={COUNTS}
        sources={[]}
        groups={[]}
        actions={[
          { label: "정리한 것까지", href: "/music?handled=shown", icon: Archive, on: true },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "정리한 것까지, 켜짐" })).toHaveAttribute(
      "href",
      "/music?handled=shown",
    );
  });
});

describe("browse card size", () => {
  it("is a pure function of the item, so the server and the client agree", () => {
    // A board that reshuffles between the server render and hydration is a board nobody
    // can scan. Nothing here reads a clock, a random, or a viewport.
    const call = () => browseCardSize({ index: 3, mediaCount: 2, portrait: false });
    expect(call()).toBe(call());
  });

  it("gives an item with nothing to show one row, and hides its media block", () => {
    expect(browseCardSize({ index: 4, mediaCount: 0, portrait: true })).toBe("small");
  });

  it("leads the board with its newest item", () => {
    expect(browseCardSize({ index: 0, mediaCount: 1, portrait: true })).toBe("wide");
  });

  it("spends height on a carousel or a portrait cover, and not otherwise", () => {
    expect(browseCardSize({ index: 1, mediaCount: 4, portrait: false })).toBe("tall");
    expect(browseCardSize({ index: 1, mediaCount: 1, portrait: true })).toBe("tall");
    expect(browseCardSize({ index: 1, mediaCount: 1, portrait: false })).toBe("medium");
  });
});
