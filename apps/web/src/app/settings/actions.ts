"use server";

import { refresh, revalidatePath } from "next/cache";
import type { AccountPlatform, SettingsPatchRequest } from "@taste-inbox/shared";
import { ApiDataError, getRepository } from "@/lib/repository";
import type { SettingsWriteResult } from "@/components/settings/fields";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";

/**
 * Settings' writes: the configuration, and which accounts to collect.
 *
 * Server Actions, so the browser never learns where the API is, and a refusal is a return
 * value rather than a throw — the service's Korean sentence is the whole content of the
 * failure, and an error boundary would replace it with "something went wrong".
 */

function failure(
  error: unknown,
  fallback: string,
): { readonly ok: false; readonly message: string } {
  if (error instanceof ApiDataError) {
    return { ok: false, message: error.message };
  }
  // Not an API refusal — the service is down, or the machine is asleep. Say which, because
  // "check the value you typed" would be wrong advice for it.
  return { ok: false, message: fallback };
}

function revalidateEverywhere(): void {
  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/library");
}

export async function saveSettings(
  changes: SettingsPatchRequest["changes"],
): Promise<SettingsWriteResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const settings = await getRepository().updateSettings(changes);
    revalidateEverywhere();
    return { ok: true, settings };
  } catch (error) {
    return failure(error, "설정을 저장하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}

export interface AccountActionResult {
  readonly ok: boolean;
  readonly message: string;
}

/** Name the account; the service collects it at once. */
export async function connectAccount(
  platform: AccountPlatform,
  handle: string,
): Promise<AccountActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const result = await getRepository().connectAccount(platform, handle);
    revalidateEverywhere();
    refresh();
    return {
      ok: true,
      message:
        result.jobId === null
          ? `'${result.handle}'로 저장했어요. 다음 수집 때 가져와요.`
          : `'${result.handle}'로 저장하고 수집을 시작했어요.`,
    };
  } catch (error) {
    return failure(error, "계정을 저장하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}

export async function disconnectAccount(platform: AccountPlatform): Promise<AccountActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    await getRepository().disconnectAccount(platform);
    revalidateEverywhere();
    refresh();
    return { ok: true, message: "연결을 해제했어요. 이미 모은 항목은 그대로 있어요." };
  } catch (error) {
    return failure(error, "연결을 해제하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}

export async function collectAccountNow(platform: AccountPlatform): Promise<AccountActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    await getRepository().collectAccount(platform);
    revalidateEverywhere();
    refresh();
    return { ok: true, message: "수집을 시작했어요." };
  } catch (error) {
    return failure(error, "수집을 시작하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}

export async function saveProfileName(name: string): Promise<AccountActionResult> {
  if (isRemoteReadOnly()) return { ok: false, message: REMOTE_READ_ONLY_MESSAGE };
  try {
    const profile = await getRepository().updateProfileName(name);
    revalidatePath("/", "layout");
    refresh();
    return { ok: true, message: `'${profile.name ?? ""}'로 저장했어요.` };
  } catch (error) {
    return failure(error, "이름을 저장하지 못했어요. 서비스가 실행 중인지 확인해 주세요.");
  }
}
