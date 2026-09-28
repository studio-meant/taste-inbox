import type {
  AccountPlatform,
  ManualItemCreateRequest,
  OnboardingField,
  OnboardingRequest,
  SettingsPatchRequest,
} from "@taste-inbox/shared";
import { ONBOARDING_FIELDS } from "@taste-inbox/shared";
import type { SettingsWriteResult } from "@/components/settings/fields";
import { ApiDataError, getRepository } from "@/lib/repository";
import { refreshDesktopRoute } from "./shims/navigation";

/**
 * The web app's Server Actions, for the desktop build.
 *
 * `vite.config.ts` resolves `@/app/(workspace)/actions`, `app/settings/actions` and
 * `app/onboarding/actions` here, so the shared pages call the same names with the same
 * results — a refusal is a return value carrying the service's sentence, never a throw.
 * The writes reach the API through the bridge's allowlist (`desktop/bridge.py`).
 */

interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

function failure(
  error: unknown,
  fallback: string,
): { readonly ok: false; readonly message: string } {
  return { ok: false, message: error instanceof ApiDataError ? error.message : fallback };
}

const REOPEN = "앱을 다시 연 뒤 시도해 주세요.";

export async function addManualItem(
  input: ManualItemCreateRequest,
): Promise<ActionResult & { readonly itemId?: string; readonly created?: boolean }> {
  try {
    const result = await getRepository().createManualItem(input);
    refreshDesktopRoute();
    return {
      ok: true,
      message: result.created ? "링크를 추가했어요." : "이미 Inbox에 있는 링크예요.",
      itemId: result.item.id,
      created: result.created,
    };
  } catch (error) {
    return failure(error, `링크를 추가하지 못했어요. ${REOPEN}`);
  }
}

export async function saveSettings(
  changes: SettingsPatchRequest["changes"],
): Promise<SettingsWriteResult> {
  try {
    const settings = await getRepository().updateSettings(changes);
    refreshDesktopRoute();
    return { ok: true, settings };
  } catch (error) {
    return failure(error, `설정을 저장하지 못했어요. ${REOPEN}`);
  }
}

export async function connectAccount(
  platform: AccountPlatform,
  handle: string,
): Promise<ActionResult> {
  try {
    const result = await getRepository().connectAccount(platform, handle);
    refreshDesktopRoute();
    return {
      ok: true,
      message:
        result.jobId === null
          ? `'${result.handle}'로 저장했어요. 다음 수집 때 가져와요.`
          : `'${result.handle}'로 저장하고 수집을 시작했어요.`,
    };
  } catch (error) {
    return failure(error, `계정을 저장하지 못했어요. ${REOPEN}`);
  }
}

export async function disconnectAccount(platform: AccountPlatform): Promise<ActionResult> {
  try {
    await getRepository().disconnectAccount(platform);
    refreshDesktopRoute();
    return { ok: true, message: "연결을 해제했어요. 이미 모은 항목은 그대로 있어요." };
  } catch (error) {
    return failure(error, `연결을 해제하지 못했어요. ${REOPEN}`);
  }
}

export async function collectAccountNow(platform: AccountPlatform): Promise<ActionResult> {
  try {
    await getRepository().collectAccount(platform);
    refreshDesktopRoute();
    return { ok: true, message: "수집을 시작했어요." };
  } catch (error) {
    return failure(error, `수집을 시작하지 못했어요. ${REOPEN}`);
  }
}

export async function saveProfileName(name: string): Promise<ActionResult> {
  try {
    const profile = await getRepository().updateProfileName(name);
    refreshDesktopRoute();
    return { ok: true, message: `'${profile.name ?? ""}'로 저장했어요.` };
  } catch (error) {
    return failure(error, `이름을 저장하지 못했어요. ${REOPEN}`);
  }
}

export async function completeOnboarding(
  request: OnboardingRequest,
): Promise<ActionResult & { readonly field?: OnboardingField }> {
  try {
    await getRepository().completeOnboarding(request);
    return { ok: true, message: "" };
  } catch (error) {
    if (error instanceof ApiDataError) {
      const field = error.code.replace(/^onboarding_/, "");
      return {
        ok: false,
        message: error.message,
        ...((ONBOARDING_FIELDS as readonly string[]).includes(field)
          ? { field: field as OnboardingField }
          : {}),
      };
    }
    return { ok: false, message: `저장하지 못했어요. ${REOPEN}` };
  }
}
