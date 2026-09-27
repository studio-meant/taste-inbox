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

  it("says a blank caption is blank rather than rendering nothing", async () => {
    render(<ItemDetail item={{ ...(await anyItem()), body: "   " }} />);
    expect(screen.getByText(/본문이 없는 게시물/)).toBeInTheDocument();
  });

  it("marks every observation with where it came from, in words", async () => {
    // Colour alone cannot separate "the platform said this" from "a recogniser guessed
    // it" (CLAUDE.md §6), and the difference is the whole point of the section.
    render(
      <ItemDetail
        item={{
          ...(await anyItem()),
          evidence: [
            {
              id: "e1",
              type: "audio_attribution",
              label: "릴스 오디오 표기",
              value: "Ella Mai - Trying",
              provenance: "fact",
            },
            {
              id: "e2",
              type: "thumbnail_track",
              label: "표지에 적힌 곡으로 보임",
              value: "Myles Lloyd - Drive Me Crazy",
              provenance: "inference",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("관찰됨")).toBeInTheDocument();
    expect(screen.getByText("추론")).toBeInTheDocument();
    expect(screen.getByText("Myles Lloyd - Drive Me Crazy")).toBeInTheDocument();
    expect(screen.getByText("확인한 정보").closest("details")).not.toHaveAttribute("open");
  });

  it("separates never-checked from checked-and-found-nothing", async () => {
    const item = await anyItem();
    const { rerender } = render(<ItemDetail item={{ ...item, evidence: [], checkedAt: null }} />);
    expect(screen.getByText(/아직 아무것도 확인하지 않았어요/)).toBeInTheDocument();

    rerender(<ItemDetail item={{ ...item, evidence: [], checkedAt: "2026-08-09T11:00:00Z" }} />);
    expect(screen.getByText(/기록할 만한 것이 없었어요/)).toBeInTheDocument();
  });

  it("always offers the original, and links back to the board it came from", async () => {
    const item = await anyItem();
    render(<ItemDetail item={{ ...item, board: "music" }} />);
    expect(screen.getByRole("link", { name: /원본 게시물 열기/ })).toHaveAttribute(
      "href",
      item.source.originalUrl,
    );
    // `Music으로`, not `Music로`. The back link used to compose `${label}로` for all four
    // boards, which is wrong Korean after a consonant; `BOARD_BACK_LABEL` spells each one.
    expect(screen.getByRole("link", { name: /Music으로 돌아가기/ })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /보드/ })).not.toBeInTheDocument();
  });

  it("returns to the exact filtered Browse URL it was opened from", async () => {
    const item = await anyItem();
    render(
      <ItemDetail
        item={{ ...item, board: "trends" }}
        backHref="/trends?kind=post&source=instagram"
      />,
    );
    expect(screen.getByRole("link", { name: /Trends로 돌아가기/ })).toHaveAttribute(
      "href",
      "/trends?kind=post&source=instagram",
    );
  });

  it("uses the board as a visible, category-toned detail state", async () => {
    const item = await anyItem();
    const { container } = render(<ItemDetail item={{ ...item, board: "style" }} />);
    const detail = container.querySelector("[data-item-detail]");
    const boardChip = detail?.querySelector("header [lang='en']");

    expect(detail).not.toBeNull();
    expect(detail).toHaveAttribute("data-board", "style");
    expect(boardChip).toHaveTextContent("Style");
  });

  it("offers the official Instagram view when a manually added post has no cached media", async () => {
    const item = await anyItem();
    render(
      <ItemDetail
        item={{
          ...item,
          title: "직접 추가한 게시물",
          photos: [],
          media: null,
          source: {
            ...item.source,
            platform: "instagram",
            originalUrl: "https://www.instagram.com/p/Manual_123/",
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Instagram 게시물 보기" })).toBeInTheDocument();
  });

  it("renders untrusted text as text", async () => {
    const { container } = render(
      <ItemDetail item={{ ...(await anyItem()), body: "<script>alert(1)</script>" }} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
  });
});
