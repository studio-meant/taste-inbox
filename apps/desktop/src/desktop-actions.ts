import type {
  ItemBoard,
  ManualItemCreateRequest,
  SettingsPatchRequest,
  SourcePlatform,
} from "@taste-inbox/shared";
import type { SettingsWriteResult } from "@/components/settings/fields";
import { ApiDataError, getRepository } from "@/lib/repository";
import { refreshDesktopRoute } from "./shims/navigation";

interface BoardMoveResult {
  readonly ok: boolean;
  readonly message: string;
  readonly board?: ItemBoard;
}

interface ManualItemResult {
  readonly ok: boolean;
  readonly message: string;
  readonly itemId?: string;
  readonly created?: boolean;
}

export async function addManualItem(input: ManualItemCreateRequest): Promise<ManualItemResult> {
  try {
    const result = await getRepository().createManualItem(input);
    refreshDesktopRoute();
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
          : "링크를 추가하지 못했어요. 앱을 다시 연 뒤 시도해 주세요.",
    };
  }
}

export async function moveItemToBoard(id: string, board: ItemBoard): Promise<BoardMoveResult> {
  try {
    const item = await getRepository().setItemBoard(id, board);
    refreshDesktopRoute();
    return {
      ok: true,
      message: "",
      ...(item.board === null ? {} : { board: item.board }),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ApiDataError
          ? error.message
          : "보드를 바꾸지 못했어요. 앱을 다시 연 뒤 시도해 주세요.",
    };
  }
}

function settingsFailure(error: unknown): SettingsWriteResult {
  return {
    ok: false,
    message:
      error instanceof ApiDataError
        ? error.message
        : "설정을 저장하지 못했어요. 앱을 다시 연 뒤 시도해 주세요.",
  };
}

export async function saveSettings(
  changes: SettingsPatchRequest["changes"],
): Promise<SettingsWriteResult> {
  try {
    const settings = await getRepository().updateSettings(changes);
    refreshDesktopRoute();
    return { ok: true, settings };
  } catch (error) {
    return settingsFailure(error);
  }
}

export async function saveSourceSetting(
  platform: SourcePlatform,
  enabled: boolean,
): Promise<SettingsWriteResult> {
  try {
    const settings = await getRepository().updateSourceSetting(platform, enabled);
    refreshDesktopRoute();
    return { ok: true, settings };
  } catch (error) {
    return settingsFailure(error);
  }
}
