import type { ItemBoard } from "@taste-inbox/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one control in the workspace that changes collected data.
 *
 * It exists because Instagram's saved collections broke and the board is now inferred:
 * measured against the 126 items the user had filed themselves, the classifier agrees on
 * 120. They were offered a filed-versus-inferred badge and declined it, asking for one
 * thing —
 *
 *     "그냥 카테고리를 수정할 수 있는 기능만 추가해줘. 그럼 인스타그램 카테고리에 포함된
 *      것만 내가 훑어보다 수정하면 되잖아."
 *
 * — so the whole design is: one field, editable, wherever the item is. These tests hold the
 * three properties that makes it work at all. It offers every destination including `None`;
 * it never claims a move the server has not accepted; and a refusal is a sentence next to
 * the control rather than an error boundary over the board.
 *
 * The Server Action is mocked. It is `"use server"` and reaches `revalidatePath`, which
 * needs a request context that jsdom does not have — and what is under test here is the
 * control, not the write. `tests/mock-repository.test.ts` and `apps/api/tests/test_api.py`
 * own the write.
 */

const move = vi.hoisted(() => vi.fn());

vi.mock("@/app/(workspace)/actions", () => ({ moveItemToBoard: move }));

const { BoardPicker } = await import("@/components/collection/BoardPicker");

beforeEach(() => {
  move.mockReset();
  move.mockResolvedValue({ ok: true, message: "", board: "music" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPicker(board: ItemBoard = "style", compact = false) {
  return render(
    <BoardPicker itemId="ig-AAA" board={board} itemTitle="여름 코디" compact={compact} />,
  );
}

describe("the board picker", () => {
  it("offers every board and None, with the current one selected", () => {
    renderPicker("style");

    const control = screen.getByRole("combobox");
    expect([...control.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Trends",
      "Style",
      "Music",
      "Places",
      "None",
    ]);
    // Selected, and therefore *text* — the state is never carried by colour alone
    // (DESIGN.md §18).
    expect((control as HTMLSelectElement).value).toBe("style");
    expect(screen.getByRole("option", { name: "Style", selected: true })).toBeInTheDocument();
  });

  it("makes None exactly as reachable as the four boards", async () => {
    // An item the classifier put on the wrong board is very often an item that belongs on
    // no board. Burying that behind a second interaction would make the common correction
    // the expensive one.
    const user = userEvent.setup();
    renderPicker("style");

    await user.selectOptions(screen.getByRole("combobox"), "none");

    expect(move).toHaveBeenCalledWith("ig-AAA", "none");
  });

  it("names the item, so a board of 76 cards is not 76 controls called 보드", () => {
    renderPicker("style", true);
    expect(screen.getByRole("combobox", { name: /여름 코디/ })).toBeInTheDocument();
  });

  it("sends nothing when the board chosen is the board already stored", async () => {
    // Selecting the current value is not a change. Sent anyway it would be a write, a
    // revalidation and a re-render of every board, for nothing.
    const user = userEvent.setup();
    renderPicker("style");

    await user.selectOptions(screen.getByRole("combobox"), "style");

    expect(move).not.toHaveBeenCalled();
  });

  it("keeps showing the stored board while the write is in flight", async () => {
    /*
     * The value is the prop, always — never a `useState` copy. A card that repainted itself
     * onto the new board before the service accepted the move would be client-side board
     * state, which CLAUDE.md §6 rules out, and would be lying for as long as the request
     * took. What arrives instead is a new prop, or the card unmounts because it has left
     * this board.
     */
    const user = userEvent.setup();
    let settle: (value: unknown) => void = () => undefined;
    move.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderPicker("style");

    await user.selectOptions(screen.getByRole("combobox"), "music");

    expect(screen.getByRole("combobox")).toHaveValue("style");
    settle({ ok: true, message: "" });
  });

  it("says in words that something is happening, not only in colour or motion", async () => {
    const user = userEvent.setup();
    let settle: (value: unknown) => void = () => undefined;
    move.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    renderPicker("style");

    await user.selectOptions(screen.getByRole("combobox"), "music");

    expect(screen.getByRole("status")).toHaveTextContent("옮기는 중");
    expect(screen.getByRole("combobox")).toBeDisabled();
    settle({ ok: true, message: "" });
  });

  it("shows a refusal beside the control rather than throwing it at the board", async () => {
    // The service answers a refused board with a Korean sentence naming what was wrong, and
    // that sentence is the whole content of the failure. Throwing would replace it with the
    // route's error boundary — which knows only that something went wrong, and would take
    // the whole board down over one card.
    const user = userEvent.setup();
    move.mockResolvedValue({ ok: false, message: "'kitchen'는 보드 이름이 아니에요." });
    renderPicker("style");

    await user.selectOptions(screen.getByRole("combobox"), "music");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("보드 이름이 아니에요");
    });
    // And the control still shows where the item actually is.
    expect(screen.getByRole("combobox")).toHaveValue("style");
  });

  it("explains what the chosen board is for where there is room, and not on a card", () => {
    // Five descriptions in the options made a 300px card's menu five long lines and put the
    // words "Style" and "Music" into the DOM of every card on every board.
    const roomy = renderPicker("places");
    expect(screen.getByText("맛집 · 카페 · 여행지")).toBeInTheDocument();
    roomy.unmount();

    renderPicker("places", true);
    expect(screen.queryByText("맛집 · 카페 · 여행지")).not.toBeInTheDocument();
  });
});
