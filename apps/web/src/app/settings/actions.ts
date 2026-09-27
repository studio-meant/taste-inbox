"use server";

import { revalidatePath } from "next/cache";
import type { SettingsPatchRequest, SourcePlatform } from "@taste-inbox/shared";
import { ApiDataError, getRepository } from "@/lib/repository";
import type { SettingsWriteResult } from "@/components/settings/fields";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";

/**
 * The two writes this screen can make, as Server Actions.
 *
 * Server Actions rather than a `fetch` from the client, for the reason the repository layer
 * exists at all: the browser never learns where the API is. `getRepository()` resolves to
 * the HTTP client or the in-memory mock depending on `NEXT_PUBLIC_DATA_SOURCE`, so the same
 * form works against fixtures with nothing running.
 *
 * A rejected write is a **return value, not a throw**. The service answers a bad change with
 * a 422 whose Korean message names the offending setting — "수집 주기를 6시간으로 줄이면
 * 소스 간격 15분이 한 주기를 넘어서요" — and that sentence is the entire content of the
 * failure. Throwing would replace it with the route's error boundary, which knows only that
 * something went wrong.
 */

function failure(error: unknown): SettingsWriteResult {
  if (error instanceof ApiDataError) {
    return { ok: false, message: error.message };
  }
  // Not an API refusal — the service is down, or the machine is asleep. Say which, because
  // "check the value you typed" would be wrong advice for it.
  return { ok: false, message: "설정을 저장하지 못했어요. 서비스가 실행 중인지 확인해 주세요." };
}

export async function saveSettings(
  changes: SettingsPatchRequest["changes"],
): Promise<SettingsWriteResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const settings = await getRepository().updateSettings(changes);
    // The schedule strip on Today reads the interval, and System reads the retention. Both
    // are rendered from a different fetch than this one.
    revalidatePath("/settings");
    revalidatePath("/system");
    revalidatePath("/today");
    return { ok: true, settings };
  } catch (error) {
    return failure(error);
  }
}

export async function saveSourceSetting(
  platform: SourcePlatform,
  enabled: boolean,
): Promise<SettingsWriteResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const settings = await getRepository().updateSourceSetting(platform, enabled);
    revalidatePath("/settings");
    revalidatePath("/system");
    return { ok: true, settings };
  } catch (error) {
    return failure(error);
  }
}
