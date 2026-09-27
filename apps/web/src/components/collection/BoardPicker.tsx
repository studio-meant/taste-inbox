"use client";

import { useId, useState, useTransition } from "react";
import type { ItemBoard } from "@taste-inbox/shared";
import { moveItemToBoard } from "@/app/(workspace)/actions";
import { BOARD_CHOICES, BOARD_LABEL, BOARD_MEANING } from "@/lib/navigation/boards";
import { cx } from "@/lib/cx";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";
import styles from "./BoardPicker.module.css";

/**
 * Which board this item is on — as a control, on the card.
 *
 * ## Why it is on the card and not only on the item's page
 *
 * The user described the workflow when they asked for this:
 *
 *     "그냥 카테고리를 수정할 수 있는 기능만 추가해줘. 그럼 인스타그램 카테고리에 포함된
 *      것만 내가 훑어보다 수정하면 되잖아."
 *
 * *훑어보다 수정한다* — read down a board and correct what is wrong. That is a scan, and a
 * scan is ruined by a round trip: 76 items on `/style`, one in twenty misfiled, and an
 * affordance that lives one navigation away turns four corrections into eight page loads and
 * eight scroll positions to find again. So the control is where the item is.
 *
 * ## Why a `<select>`
 *
 * Five choices, one of which is already true, and the answer is the whole interaction. A
 * native select gets keyboard operation, a touch-native sheet on mobile, and correct
 * announcement of "which of five, and which is current" for free — none of which a row of
 * five buttons on a 300px card would have, and all of which it would have to reimplement.
 * The current board is the selected option, which is text: the state is never carried by
 * colour (DESIGN.md §18).
 *
 * `None` is the fifth option and reachable in exactly the same gesture as the other four,
 * which was a requirement rather than a convenience. An item the classifier put on the wrong
 * board is very often an item that belongs on no board.
 *
 * ## Why there is no local copy of the value
 *
 * `value` is the prop, always. The write goes to the service, the service answers with where
 * the item actually landed, `revalidatePath` re-renders the route, and the new board arrives
 * as a new prop — or the card leaves the board and unmounts. Holding the choice in
 * `useState` would make the card claim a move the server had not accepted, which is the
 * client-side board state CLAUDE.md §6 rules out. The two pieces of state here are
 * transient UI and nothing else: whether a request is in flight, and the sentence to show if
 * it failed.
 */
export function BoardPicker({
  itemId,
  board,
  /** The item's title, so the control's accessible name says *which* item it moves. */
  itemTitle,
  /** Trimmed for the footer of a card; roomy on the item's own page. */
  compact = false,
}: {
  readonly itemId: string;
  readonly board: ItemBoard;
  readonly itemTitle?: string;
  readonly compact?: boolean;
}) {
  const id = useId();
  const statusId = `${id}-status`;
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const readOnly = isRemoteReadOnly();

  function choose(next: string): void {
    if (readOnly || next === board) return;
    setFailure(null);
    startTransition(async () => {
      const result = await moveItemToBoard(itemId, next as ItemBoard);
      if (!result.ok) {
        setFailure(result.message);
      }
    });
  }

  // Names the item as well as the control. On a board of 76 cards, seventy-six selects all
  // called "보드" are seventy-six controls a screen-reader user cannot tell apart.
  const name = itemTitle === undefined ? "보드" : `보드 — ${itemTitle}`;

  return (
    <div className={cx(styles.picker, compact ? styles.compact : null)}>
      <label className={styles.label} htmlFor={id}>
        {compact ? <span className="visually-hidden">{name}</span> : "보드"}
      </label>
      <select
        id={id}
        className={styles.select}
        value={board}
        disabled={pending || readOnly}
        title={readOnly ? REMOTE_READ_ONLY_MESSAGE : undefined}
        data-read-only={readOnly || undefined}
        aria-label={compact ? name : undefined}
        aria-describedby={statusId}
        onChange={(event) => {
          choose(event.target.value);
        }}
      >
        {/*
         * The board name and nothing else. What each board is for is said once, under the
         * control, for the board currently chosen — putting all five descriptions in the
         * options made a 300px card's menu five long lines, and put the words "Style" and
         * "Music" inside the DOM of every card on every board.
         */}
        {BOARD_CHOICES.map((choice) => (
          <option key={choice} value={choice} lang="en">
            {BOARD_LABEL[choice]}
          </option>
        ))}
      </select>
      {/* Only where there is room for it. A card has none, and the option names carry
          enough on a board the reader is already standing on. */}
      {compact ? null : (
        <p className={cx(styles.meaning, "type-body-small")}>{BOARD_MEANING[board]}</p>
      )}
      {/*
       * One live region for both outcomes, and it is never empty of meaning while something
       * is happening. A spinner alone would be a colour-and-motion status; this says what is
       * going on in words (DESIGN.md §18, CLAUDE.md §6).
       */}
      <p
        className={cx(styles.status, failure === null ? null : styles.failed)}
        id={statusId}
        role="status"
        aria-live="polite"
      >
        {pending ? "옮기는 중" : (failure ?? "")}
      </p>
    </div>
  );
}
