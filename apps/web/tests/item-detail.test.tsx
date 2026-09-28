import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ItemDetail } from "@/components/items/ItemDetail";
import { MockRepository } from "@/lib/mock/repository";

/**
 * The screen someone opens because a card was too short — so the property under test is
 * that it summarises nothing.
 */

const repository = new MockRepository();

async function anyItem() {
  const today = await repository.getToday();
  const lead = today.leadConnection;
  if (lead === null) throw new Error("fixture lost its lead connection");
  const item = await repository.getItem(lead.href.replace("/items/", ""));
  if (item === null) throw new Error("fixture lead connection points at nothing");
  return item;
}

describe("ItemDetail", () => {
  it("renders the body whole, with no expander to reveal the rest", async () => {
    const item = await anyItem();
    const long = "가".repeat(900) + "끝";
    render(<ItemDetail item={{ ...item, body: long }} />);

    const body = screen.getByText(long);
    expect(body.textContent).toHaveLength(901);
    expect(screen.queryByText("전문 보기")).not.toBeInTheDocument();
  });

  it("says a blank description is blank rather than rendering nothing", async () => {
    render(<ItemDetail item={{ ...(await anyItem()), body: "   " }} />);
    expect(screen.getByText(/본문이 없는 항목/)).toBeInTheDocument();
  });

  it("marks every observation with where it came from, in words", async () => {
    // Colour alone cannot separate "the source said this" from "research inferred it"
    // (CLAUDE.md §6), and the difference is the whole point of the section.
    render(
      <ItemDetail
        item={{
          ...(await anyItem()),
          evidence: [
            {
              id: "e1",
              type: "paper.github_repo",
              label: "코드",
              value: "https://github.com/sample-org/self-check",
              provenance: "fact",
            },
            {
              id: "e2",
              type: "research.suggestion",
              label: "다음 한 걸음",
              value: "작은 입력으로 검산 루프를 돌려 본다",
              provenance: "inference",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("관찰됨")).toBeInTheDocument();
    expect(screen.getByText("추론")).toBeInTheDocument();
    expect(screen.getByText("작은 입력으로 검산 루프를 돌려 본다")).toBeInTheDocument();
    expect(screen.getByText("확인한 정보").closest("details")).not.toHaveAttribute("open");
  });

  it("separates never-checked from checked-and-found-nothing", async () => {
    const item = await anyItem();
    const { rerender } = render(<ItemDetail item={{ ...item, evidence: [], checkedAt: null }} />);
    expect(screen.getByText(/아직 아무것도 확인하지 않았어요/)).toBeInTheDocument();

    rerender(<ItemDetail item={{ ...item, evidence: [], checkedAt: "2026-08-09T11:00:00Z" }} />);
    expect(screen.getByText(/기록할 만한 것이 없었어요/)).toBeInTheDocument();
  });

  it("always offers the original, and links back to the Inbox", async () => {
    const item = await anyItem();
    render(<ItemDetail item={item} />);
    expect(screen.getByRole("link", { name: /원본 열기/ })).toHaveAttribute(
      "href",
      item.source.originalUrl,
    );
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/library");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("returns to the exact filtered Inbox URL it was opened from", async () => {
    const item = await anyItem();
    render(<ItemDetail item={item} backHref="/library?kind=paper&source=huggingface" />);
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/library?kind=paper&source=huggingface",
    );
  });

  it("names what the item is, in English, where the board chip used to be", async () => {
    const item = await anyItem();
    const { container } = render(<ItemDetail item={{ ...item, kind: "paper" }} />);
    const chip = container.querySelector("[data-item-detail] header [lang='en']");
    expect(chip).toHaveTextContent("Paper");
    expect(container.querySelector("[data-board]")).toBeNull();
  });

  it("renders untrusted text as text", async () => {
    const { container } = render(
      <ItemDetail item={{ ...(await anyItem()), body: "<script>alert(1)</script>" }} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});
