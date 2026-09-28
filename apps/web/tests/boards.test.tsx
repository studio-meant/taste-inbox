import type { AIItemCardModel } from "@taste-inbox/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AIItemCard } from "@/components/ai/AIItemCard";
import { BoardHeader } from "@/components/collection/BoardHeader";
import { CollectionRail } from "@/components/collection/CollectionRail";
import type { FilterGroup } from "@/components/collection/FilterChipRow";

/**
 * The Inbox's card, header and rail, rendering items that have been collected but not yet
 * enriched.
 *
 * These tests hold the line DESIGN.md §3.5 draws: a card may show what was observed, and
 * must not dress an unknown up as a finding.
 */

const SOURCE = {
  platform: "github",
  label: "GitHub",
  originalUrl: "https://github.com/sample-org/agent-kit",
  author: "sample-org",
  actionType: "star",
  firstSeenAt: "2026-08-08T04:05:41.000Z",
} as const;

function aiItem(overrides: Partial<AIItemCardModel> = {}): AIItemCardModel {
  return {
    id: "agent-kit",
    kind: "repo",
    title: "sample-org/agent-kit",
    summary: "A small toolkit for agents.",
    checkedAt: null,
    source: SOURCE,
    tags: [],
    links: [],
    ...overrides,
  };
}

describe("BoardHeader", () => {
  it("says the items were really collected", () => {
    render(<BoardHeader title="Inbox" lead="l" total={76} collected unenrichedNote="n" />);
    expect(screen.getByText("수집됨")).toBeInTheDocument();
    expect(screen.queryByText("샘플 데이터")).not.toBeInTheDocument();
  });

  it("says so when it is showing seed data instead", () => {
    // Committed fixtures and the user's own stars look identical otherwise, and judging the
    // product on the wrong one is a real error.
    render(<BoardHeader title="Inbox" lead="l" total={4} collected={false} unenrichedNote="n" />);
    expect(screen.getByText("샘플 데이터")).toBeInTheDocument();
  });

  it("does not rely on colour alone to say which", () => {
    const { rerender } = render(
      <BoardHeader title="Inbox" lead="l" total={1} collected unenrichedNote="n" />,
    );
    expect(screen.getByLabelText("실제로 수집한 항목입니다")).toBeInTheDocument();
    rerender(<BoardHeader title="Inbox" lead="l" total={1} collected={false} unenrichedNote="n" />);
    expect(screen.getByLabelText("예시 데이터입니다")).toBeInTheDocument();
  });

  it("explains that nothing has been enriched, while there is anything to explain", () => {
    const note = "아직 확인하지 않았어요.";
    const { rerender } = render(
      <BoardHeader title="Inbox" lead="l" total={76} collected unenrichedNote={note} />,
    );
    expect(screen.getByText(note)).toBeInTheDocument();

    rerender(<BoardHeader title="Inbox" lead="l" total={0} collected unenrichedNote={note} />);
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it("allows the explanatory strip to be omitted", () => {
    render(<BoardHeader title="Inbox" lead="l" total={4} collected />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("keeps the English name marked as English for screen readers", () => {
    render(<BoardHeader title="Inbox" lead="l" total={1} collected unenrichedNote="n" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("lang", "en");
  });
});

describe("AIItemCard", () => {
  it("names the link by where it goes, not by an action this product takes", () => {
    render(<AIItemCard item={aiItem()} />);
    const link = screen.getByRole("link", { name: /저장소 열기/ });
    expect(link).toHaveAttribute("href", SOURCE.originalUrl);
  });

  it("names the Hugging Face page for a Hugging Face item", () => {
    render(
      <AIItemCard
        item={aiItem({
          kind: "model",
          source: {
            ...SOURCE,
            platform: "huggingface",
            label: "Hugging Face",
            actionType: "like",
            originalUrl: "https://huggingface.co/sample-org/tiny",
          },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /Hugging Face에서 열기/ })).toHaveAttribute(
      "href",
      "https://huggingface.co/sample-org/tiny",
    );
  });

  it("says what kind of thing it is, in English", () => {
    const { rerender } = render(<AIItemCard item={aiItem()} />);
    expect(screen.getByText("Repo")).toBeInTheDocument();

    rerender(<AIItemCard item={aiItem({ kind: "paper" })} />);
    expect(screen.getByText("Paper")).toBeInTheDocument();
  });

  it("offers the Lab in the corner and moves the permalink into the link list", () => {
    render(<AIItemCard item={aiItem()} labHref="/focus/agent-kit" />);
    expect(screen.getByRole("link", { name: /Open in Lab/ })).toHaveAttribute(
      "href",
      "/focus/agent-kit",
    );
    // The signal is still said, to a screen reader and on hover.
    expect(screen.getByRole("link", { name: /GitHub 스타/ })).toHaveAttribute(
      "href",
      SOURCE.originalUrl,
    );
  });

  it("keeps the links the item carried", () => {
    render(
      <AIItemCard
        item={aiItem({
          links: [
            {
              id: "l1",
              url: "https://github.com/sample-org/paper-code",
              label: "github.com",
              kind: "artifact",
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /github\.com/ })).toHaveAttribute(
      "href",
      "https://github.com/sample-org/paper-code",
    );
  });

  it("makes no claim about running the thing", () => {
    render(<AIItemCard item={aiItem()} />);
    expect(screen.queryByText(/Ready|Needs token|Not checked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/예상 최대 메모리/)).not.toBeInTheDocument();
  });

  it("shows the topics the source wrote", () => {
    render(<AIItemCard item={aiItem({ tags: ["agents", "llm"] })} />);
    expect(screen.getByText("agents")).toBeInTheDocument();
  });

  it("keeps the whole of a long description, and the way to read it is its title", () => {
    const long = "가".repeat(600) + "끝";
    render(<AIItemCard item={aiItem({ summary: long })} />);

    // Present in the DOM, not merely promised: the clamp is CSS, so the text is all here.
    for (const node of screen.getAllByText(long)) {
      expect(node.textContent).toHaveLength(601);
    }
    const toItem = screen.getByRole("link", { name: "sample-org/agent-kit" });
    expect(toItem).toHaveAttribute("href", "/items/agent-kit");
    expect(screen.queryByText("전문 보기")).not.toBeInTheDocument();
  });
});

describe("CollectionRail", () => {
  const SOURCES = [{ platform: "github", label: "GitHub", count: 76 }] as const;

  const KIND_GROUP: readonly FilterGroup[] = [
    {
      key: "kind",
      legend: "종류",
      options: [
        { value: "repo", label: "Repo", count: 3 },
        { value: "paper", label: "Paper", count: 5 },
      ],
    },
  ];

  it("is still there when no facet can separate the Inbox", () => {
    // A missing rail once let the list land in an `auto` track two pixels wide.
    render(<CollectionRail pathname="/library" params={{}} sources={SOURCES} groups={[]} />);
    expect(screen.getByRole("navigation", { name: "Inbox 필터" })).toBeInTheDocument();
  });

  it("lists a source that cannot narrow the Inbox as a count, not as a control", () => {
    // A filter that always returns everything reads as "no matches", which is a claim about
    // the items rather than about the product (DESIGN.md §3.5).
    render(<CollectionRail pathname="/library" params={{}} sources={SOURCES} groups={[]} />);

    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("76개")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /GitHub/ })).not.toBeInTheDocument();
  });

  it("offers a source as a filter as soon as it can narrow something", () => {
    const sourceGroup: readonly FilterGroup[] = [
      {
        key: "source",
        legend: "출처",
        options: [
          { value: "github", label: "GitHub", count: 2 },
          { value: "huggingface", label: "Hugging Face", count: 6 },
        ],
      },
    ];
    render(
      <CollectionRail
        pathname="/library"
        params={{}}
        sources={[
          { platform: "github", label: "GitHub", count: 2 },
          { platform: "huggingface", label: "Hugging Face", count: 6 },
        ]}
        groups={sourceGroup}
      />,
    );

    // The filter, not the count list — a source is never listed twice.
    expect(screen.getByRole("link", { name: "GitHub 2개" })).toHaveAttribute(
      "href",
      "/library?source=github",
    );
    expect(screen.getAllByText("Hugging Face")).toHaveLength(1);
  });

  it("keeps the facet rows the Inbox can actually use", () => {
    render(
      <CollectionRail
        pathname="/library"
        params={{ kind: "repo" }}
        sources={[]}
        groups={KIND_GROUP}
      />,
    );

    // The selected row is the way back: clicking it again drops the group entirely.
    expect(screen.getByRole("link", { name: "Repo 3개, 선택됨" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.getByRole("link", { name: "Paper 5개" })).toBeInTheDocument();
  });

  it("lists no boards — they went with Instagram", () => {
    render(<CollectionRail pathname="/library" params={{}} sources={SOURCES} groups={[]} />);
    expect(screen.queryByText("Browse by type")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Trends|Style|Music|Places|None/ })).toBeNull();
  });
});
