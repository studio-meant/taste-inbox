import type {
  SettingBoolean,
  SettingChoice,
  SettingEffect,
  SettingKey,
  SettingNumber,
  SettingOrigin,
  SettingText,
  SettingsDocument,
  SettingsPatchRequest,
} from "@taste-inbox/shared";
import {
  CircleDashed,
  CircleDot,
  FileText,
  Lock,
  Pencil,
  RefreshCw,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * What the settings screen says about each value, and where each value lives in the payload.
 *
 * The copy is here rather than inside the row component for the reason the payload itself
 * gives: `editable: false` arrives for two very different reasons — nothing reads the value,
 * or writing it is unsafe — and the boolean cannot tell them apart. The screen has to, so
 * every field carries the sentence that says which, written from the code that proves it.
 * A row rendered without one would print a padlock and no reason, which is the shape of an
 * arbitrary restriction rather than an honest one.
 *
 * `read` rather than a dotted-path lookup so the document's shape is checked by the compiler:
 * a section renamed in `@taste-inbox/shared` fails here instead of resolving to `undefined`
 * and rendering an empty row.
 */

export type SettingsSectionId = "collection" | "appearance" | "privacy" | "general" | "features";

export interface SettingsSection {
  readonly id: SettingsSectionId;
  readonly heading: string;
  readonly description: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "collection",
    heading: "수집",
    description:
      "수집기가 얼마나 자주, 어떤 간격으로 계정을 여는지 정합니다. 이 화면에서 바꾼 값이 실제로 동작하는 유일한 구간이에요.",
  },
  {
    id: "general",
    heading: "일반",
    description: "시간대와 언어, 앱을 열 때 거치는 순서처럼 제품 전체에 걸리는 값입니다.",
  },
  {
    id: "appearance",
    heading: "화면과 모션",
    description:
      "설정 파일에 적힌 기본 테마와 모션입니다. 지금 보고 있는 화면의 테마는 이 값이 아니라 브라우저에 저장된 값이고, 그 값은 System 화면의 '테마'에서 고릅니다. 여기서는 파일에 무엇이 적혀 있는지만 보여드려요.",
  },
  {
    id: "privacy",
    heading: "기록 정리",
    description: "실패했을 때 남는 화면 캡처를 언제까지 두는지에 대한 값입니다.",
  },
  {
    id: "features",
    heading: "기능 플래그",
    description:
      "CLAUDE.md는 수집기마다 따로 켜고 끌 수 있어야 한다고 적고 있어요. 값은 이미 설정 파일에 있지만, 아직 이 값을 읽는 코드가 없습니다.",
  },
];

interface SettingFieldBase {
  readonly key: SettingKey;
  readonly section: SettingsSectionId;
  /** The control's accessible name. Also the read-only row's leading text. */
  readonly label: string;
  /** What this value changes. One sentence, always present, editable or not. */
  readonly description: string;
  /**
   * Said next to the effect chip when the chip alone would mislead.
   *
   * Three fields need one, and they need it badly. `immediate | nextRun | nextInstall` has
   * no member for "both", and the two collection numbers genuinely have two clocks; and
   * `immediate` is a claim about the next *request*, which for 시작 연출 means the next time
   * the app is opened rather than anything the user can watch happen on this screen.
   */
  readonly effectNote?: string;
  /** Why this value is fixed. Rendered only when the payload says `editable: false`. */
  readonly fixedReason: string;
  /** Rendered after a number, e.g. `시간`. */
  readonly unit?: string;
}

export type SettingField =
  | (SettingFieldBase & {
      readonly kind: "number";
      readonly read: (settings: SettingsDocument) => SettingNumber;
    })
  | (SettingFieldBase & {
      readonly kind: "boolean";
      readonly read: (settings: SettingsDocument) => SettingBoolean;
    })
  | (SettingFieldBase & {
      readonly kind: "choice";
      readonly read: (settings: SettingsDocument) => SettingChoice;
    })
  | (SettingFieldBase & {
      readonly kind: "text";
      readonly read: (settings: SettingsDocument) => SettingText;
    });

/**
 * The launchd sentence, said on both collection numbers.
 *
 * Neither `immediate` nor `nextInstall` is the whole truth: `/api/collection/schedule`
 * recomputes from disk on every request because `config/loader.py` caches nothing, so the
 * next-run times on screen move at once — while a launchd job that has already been loaded
 * carries the `StartInterval` it was bootstrapped with until somebody runs `bootout` and
 * `bootstrap` by hand. Nothing in this repository runs `launchctl`.
 *
 * The second sentence names a destination, so it has to keep naming one that exists. It
 * pointed at System for weeks while `/system` contained no reference to launchd at all and
 * `GET /api/collection/launchd` had no consumer anywhere in `apps/web`. It now names the
 * section heading `components/system/LaunchdPanel.tsx` renders, and `tests/launchd.test.tsx`
 * holds the two together so the pointer cannot dangle again — and it says who runs the
 * command, because the screen it points at does not offer to.
 */
const LAUNCHD_NOTE =
  "다음 수집 시각 표시는 바로 바뀌지만, launchd에 이미 등록된 작업은 다시 등록할 때까지 옛 간격으로 실행돼요. 해제하고 다시 등록하는 명령은 System 화면의 '수집 작업 등록'에 있고, 실행은 터미널에서 직접 하셔야 합니다.";

export const SETTING_FIELDS: readonly SettingField[] = [
  {
    key: "collection.intervalHours",
    section: "collection",
    kind: "number",
    read: (settings) => settings.collection.intervalHours,
    label: "수집 간격",
    unit: "시간",
    description:
      "자정을 기준으로 몇 시간마다 계정을 열지 정합니다. 4시간이면 하루 여섯 번이에요. 간격은 최신성만 정하고 빠짐없이 가져오는 것과는 상관이 없어서, 한 번 걸러도 잃는 항목은 없습니다.",
    effectNote: LAUNCHD_NOTE,
    fixedReason: "",
  },
  {
    key: "collection.staggerMinutes",
    section: "collection",
    kind: "number",
    read: (settings) => settings.collection.staggerMinutes,
    label: "계정별 시차",
    unit: "분",
    description:
      "한 번의 수집에서 계정을 몇 분씩 띄워 열지 정합니다. 0이면 여섯 계정을 같은 분에 엽니다. 여섯 계정이 모두 한 번의 간격 안에 들어가야 해서, 넣을 수 있는 최댓값은 수집 간격에 따라 달라져요.",
    effectNote: LAUNCHD_NOTE,
    fixedReason: "",
  },
  {
    key: "collection.allowManualRefresh",
    section: "collection",
    kind: "boolean",
    read: (settings) => settings.collection.allowManualRefresh,
    label: "지금 수집 허용",
    description:
      "꺼두면 다음 간격이 올 때까지 기다립니다. 켜져 있어야 화면에서 수집을 바로 시작할 수 있어요.",
    fixedReason: "",
  },
  {
    key: "general.timezone",
    section: "general",
    kind: "text",
    read: (settings) => settings.general.timezone,
    label: "시간대",
    description:
      "Today의 하루 경계와 수집 시각이 모두 이 값을 씁니다. 이 화면에서 실제로 쓰이는 값 중 하나예요.",
    fixedReason:
      "잘못된 시간대 이름을 적어도 오류가 나지 않고 조용히 UTC로 넘어가서, 하루 경계와 모든 수집 시각이 몇 시간씩 밀린 채로 화면에는 적어둔 이름이 그대로 남아요. 이름을 확인하는 절차가 생기기 전까지는 설정 파일에서만 바꿉니다.",
  },
  {
    key: "general.locale",
    section: "general",
    kind: "text",
    read: (settings) => settings.general.locale,
    label: "언어",
    description: "설정 파일에 적힌 언어 코드입니다.",
    fixedReason: "설정 파일에만 있고 아직 아무 코드도 읽지 않아요.",
  },
  {
    key: "general.ceremonialEntry",
    section: "general",
    kind: "choice",
    read: (settings) => settings.general.ceremonialEntry,
    label: "시작 연출",
    // The three option values render as they arrive — `full`, `brief`, `skip` — so the
    // description has to say what each one does. They are the config's own vocabulary and
    // the same three words `PAGE_SPECIFICATIONS.md` §11.1 uses; translating them here would
    // put a second name on a value the payload, the config file and the API error message
    // all spell the first way.
    description:
      "앱을 열 때 Today 앞에 무엇을 거칠지 정합니다. full은 Splash를 지나 Greeting을 거쳐 Today로, brief는 Greeting만 거쳐 Today로, skip은 곧장 Today로 들어옵니다. 매일 여러 번 여는 도구라 연출을 줄이거나 아예 끄고 쓸 수 있어야 해서 둔 값이에요. 모션을 줄이는 설정에서는 full을 골라도 Splash에 머무르지 않고 바로 넘어갑니다.",
    effectNote: "다음에 앱을 열 때부터 달라져요. 지금 보고 있는 이 화면은 그대로입니다.",
    fixedReason: "",
  },
  {
    key: "appearance.defaultTheme",
    section: "appearance",
    kind: "choice",
    read: (settings) => settings.appearance.defaultTheme,
    label: "기본 테마",
    description: "설정 파일에 적힌 테마 이름입니다.",
    /*
     * Rewritten the day the picker shipped.
     *
     * This row is still fixed, and for the same reason as before — nothing reads the file
     * value. What changed is the sentence that used to follow it: "여기서 바꿔도 색이
     * 달라지지 않습니다" was written when no control existed anywhere, and reading it now
     * would leave someone believing the theme cannot be changed at all. The row has to
     * name the place that does change it, and admit the two values can disagree.
     */
    fixedReason:
      "설정 파일의 이 값을 읽는 코드는 아직 없어요. 화면에 보이는 테마는 브라우저에 저장된 값이고, 고르는 곳은 System 화면의 '테마'입니다. 그래서 여기 적힌 이름과 지금 보고 있는 테마가 다를 수 있어요.",
  },
  {
    key: "appearance.defaultMotion",
    section: "appearance",
    kind: "choice",
    read: (settings) => settings.appearance.defaultMotion,
    label: "기본 모션",
    description: "설정 파일에 적힌 모션 모드입니다.",
    fixedReason:
      "이 값도 아직 아무 곳에서도 읽지 않아요. 게다가 화면에는 cinematic·ambient·reduced 세 가지가 있는데 설정 파일은 ambient를 적을 수 없어서, 고를 수 있는 목록이 화면과 다릅니다.",
  },
  {
    key: "privacy.debugRetentionDays",
    section: "privacy",
    kind: "number",
    read: (settings) => settings.privacy.debugRetentionDays,
    label: "실패 캡처 보관 기간",
    unit: "일",
    description: "수집이 실패했을 때 남긴 화면 캡처를 며칠 뒤에 지울지 정하는 값입니다.",
    fixedReason:
      "캡처를 지우는 코드가 이 값 대신 자기 기본값 7일을 씁니다. 숫자를 고칠 수 있게 두면 며칠로 적든 7일 뒤에 지워져요.",
  },
  {
    key: "features.shareCapture",
    section: "features",
    kind: "boolean",
    read: (settings) => settings.features.shareCapture,
    label: "공유 시트로 담기",
    description: "다른 앱의 공유 시트에서 항목을 바로 담는 경로입니다.",
    fixedReason: "값은 설정 파일에 있지만 읽는 코드가 없어서, 켜도 아무 일도 일어나지 않아요.",
  },
  {
    key: "features.historicalImport",
    section: "features",
    kind: "boolean",
    read: (settings) => settings.features.historicalImport,
    label: "과거 기록 가져오기",
    description: "지금까지 쌓인 예전 신호를 한 번에 불러오는 경로입니다.",
    fixedReason: "값은 설정 파일에 있지만 읽는 코드가 없어서, 켜도 아무 일도 일어나지 않아요.",
  },
  {
    key: "features.linkedinCollector",
    section: "features",
    kind: "boolean",
    read: (settings) => settings.features.linkedinCollector,
    label: "LinkedIn 수집기",
    description: "LinkedIn 반응을 수집기 목록에 넣을지 정하는 값입니다.",
    fixedReason:
      "수집기를 고르는 코드가 이 값이 아니라 고정된 목록을 봅니다. 꺼도 LinkedIn은 그대로 목록에 남아요.",
  },
  {
    key: "features.localModelEnrichment",
    section: "features",
    kind: "boolean",
    read: (settings) => settings.features.localModelEnrichment,
    label: "로컬 모델 보강",
    description: "이 Mac에서 도는 모델로 수집한 항목을 보강할지 정하는 값입니다.",
    fixedReason: "값은 설정 파일에 있지만 읽는 코드가 없어서, 켜도 아무 일도 일어나지 않아요.",
  },
];

/** Everything a patch can carry. The backend re-validates per key; this is the wire shape. */
export type SettingValue = number | boolean | string;

/** Field lookup by dotted key, for the draft bookkeeping in `SettingsForm`. */
const FIELD_BY_KEY: ReadonlyMap<SettingKey, SettingField> = new Map(
  SETTING_FIELDS.map((field) => [field.key, field]),
);

/**
 * The value currently saved under a key, or `undefined` for a key with no field.
 *
 * Used to drop a draft entry the moment the user types the saved value back in: a patch that
 * sets a field to what it already is would still flip `origin` to `user`, permanently
 * marking a row as personally changed when nothing about it changed.
 */
export function savedValue(settings: SettingsDocument, key: SettingKey): SettingValue | undefined {
  return FIELD_BY_KEY.get(key)?.read(settings).value;
}

/**
 * What a write answers with.
 *
 * A result union rather than a thrown error, because the write crosses a Server Action
 * boundary: Next.js replaces a thrown error's message with a generic one in a production
 * build, and the message is the entire content of a rejected setting — the service names the
 * offending value in Korean and there is nowhere else to read that from.
 */
export type SettingsWriteResult =
  | { readonly ok: true; readonly settings: SettingsDocument }
  | { readonly ok: false; readonly message: string };

export type SaveSettings = (
  changes: SettingsPatchRequest["changes"],
) => Promise<SettingsWriteResult>;

export interface Badge {
  readonly label: string;
  readonly icon: LucideIcon;
}

/**
 * Where the effective value came from — the question this screen exists to answer.
 *
 * `file` says "설정 파일" and pointedly not "누군가 바꾼 값". There is no `config/app.yaml`
 * on a fresh checkout (`.gitignore` ignores `config/*.yaml`), so the resolver falls through
 * to the committed `config/app.example.yaml` and almost everything reports `file` — which is
 * the shipped value living in a file, not somebody's edit.
 */
export const ORIGIN_BADGE: Readonly<Record<SettingOrigin, Badge>> = {
  default: { label: "기본값", icon: CircleDashed },
  file: { label: "설정 파일 값", icon: FileText },
  user: { label: "직접 바꾼 값", icon: Pencil },
};

/** When a change starts being true. Rendered only where a change is possible. */
export const EFFECT_BADGE: Readonly<Record<SettingEffect, Badge>> = {
  immediate: { label: "즉시 적용", icon: Zap },
  nextRun: { label: "다음 수집부터", icon: RefreshCw },
  nextInstall: { label: "다음 설치부터", icon: Wrench },
};

export const FIXED_BADGE: Badge = { label: "고정됨", icon: Lock };

export const UNSAVED_BADGE: Badge = { label: "저장 안 됨", icon: CircleDot };

/** Said inside the sections that do render, about the controls those sections do not have. */
export const SECTION_ASIDE: Readonly<Partial<Record<SettingsSectionId, string>>> = {
  appearance:
    "배경 농도는 화면마다 글이 잘 읽히도록 알아서 정해집니다. 사용자가 고르는 값이 아니에요. 카드 밀도는 주소에는 남지만 아직 화면을 바꾸지 않아서, 동작할 때까지 스위치를 두지 않았어요.",
};
