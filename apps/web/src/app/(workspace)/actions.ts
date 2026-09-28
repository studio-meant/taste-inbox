"use server";

import { revalidatePath } from "next/cache";
import type { ManualItemCreateRequest } from "@taste-inbox/shared";
import { ApiDataError, getRepository } from "@/lib/repository";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";

/**
 * The workspace's one write: a link a person adds to the Inbox by hand.
 *
 * A Server Action rather than a `fetch` from the form, for the reason `app/settings/actions.ts`
 * gives: the browser never learns where the API is, and `getRepository()` resolves to the
 * HTTP client or the in-memory mock depending on `NEXT_PUBLIC_DATA_SOURCE`.
 *
 * A rejected write is a **return value, not a throw**: the service's Korean sentence is the
 * whole content of the failure, and an error boundary would replace it with "something went
 * wrong".
 */

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
    revalidatePath("/library");
    revalidatePath("/today");
    return {
      ok: true,
      message: result.created ? "링크를 추가했어요." : "이미 Inbox에 있는 링크예요.",
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
