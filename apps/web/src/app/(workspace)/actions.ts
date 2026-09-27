"use server";

import { revalidatePath } from "next/cache";
import type { ItemBoard } from "@taste-inbox/shared";
import type { ManualItemCreateRequest } from "@taste-inbox/shared";
import { ApiDataError, getRepository } from "@/lib/repository";
import { BOARD_HREF } from "@/lib/navigation/boards";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";

/**
 * The workspace's one write: which board an item is on.
 *
 * A Server Action rather than a `fetch` from the card, for the reason `app/settings/actions.ts`
 * gives: the browser never learns where the API is, and `getRepository()` resolves to the
 * HTTP client or the in-memory mock depending on `NEXT_PUBLIC_DATA_SOURCE`, so the control
 * works against fixtures with nothing running.
 *
 * A rejected write is a **return value, not a throw**, the same as the settings writes. The
 * service answers a refused board with a 422 whose Korean message names what was wrong, and
 * that sentence is the whole content of the failure; throwing would replace it with the
 * route's error boundary, which knows only that something went wrong — and would take the
 * whole board down over one card.
 */

export interface BoardMoveResult {
  readonly ok: boolean;
  /** Present when `ok` is false. Shown next to the control that failed. */
  readonly message: string;
  /** Where the item ended up, read back off the service. Absent on failure. */
  readonly board?: ItemBoard;
}

export interface ManualItemResult {
  readonly ok: boolean;
  readonly message: string;
  readonly itemId?: string;
  readonly created?: boolean;
}

export async function addManualItem(input: ManualItemCreateRequest): Promise<ManualItemResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const result = await getRepository().createManualItem(input);
    for (const href of Object.values(BOARD_HREF)) revalidatePath(href);
    revalidatePath("/library");
    revalidatePath("/today");
    return {
      ok: true,
      message: result.created ? "링크를 추가했어요." : "이미 있던 링크의 보드를 옮겼어요.",
      itemId: result.item.id,
      created: result.created,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ApiDataError
          ? error.message
          : "링크를 추가하지 못했어요. 서비스가 실행 중인지 확인해 주세요.",
    };
  }
}

export async function moveItemToBoard(id: string, board: ItemBoard): Promise<BoardMoveResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  let landed: ItemBoard | null;
  try {
    const item = await getRepository().setItemBoard(id, board);
    // What the service says, not what was asked for. The two agree today; the point is that
    // if they ever stop, the screen follows the database.
    landed = item.board;
  } catch (error) {
    if (error instanceof ApiDataError) {
      return { ok: false, message: error.message };
    }
    // Not a refusal — the service is down, or the machine is asleep. Said plainly, because
    // "고른 값을 확인해 주세요" would be wrong advice for it.
    return { ok: false, message: "보드를 바꾸지 못했어요. 서비스가 실행 중인지 확인해 주세요." };
  }

  /*
   * Every route whose contents this could have changed, and no client-side board state
   * anywhere (CLAUDE.md §6 — the URL is the source of truth).
   *
   * Both boards, not only the destination: an item leaving `/style` for `/music` changes
   * what each of them holds, and the card the user is looking at is on the one it left. The
   * whole list is revalidated rather than a computed pair because the counts in the rail are
   * rendered on every board from `getBoardCounts()`, so all five move whichever two the item
   * crossed between.
   *
   * `/library` merges four of them and `/today` counts the day's saves per board; both
   * render from their own fetch and would otherwise keep yesterday's answer until a reload.
   */
  for (const href of Object.values(BOARD_HREF)) {
    revalidatePath(href);
  }
  revalidatePath("/library");
  revalidatePath("/today");
  // The item's own page, which carries the same control and the back link that has just
  // changed where it points.
  revalidatePath(`/items/${id}`);

  return { ok: true, message: "", ...(landed === null ? {} : { board: landed }) };
}
