"use client";

import { useState } from "react";
import type { SettingKey, SettingsDocument, SettingsPatchRequest } from "@taste-inbox/shared";
import { Save, Undo2 } from "lucide-react";
import { Button, ErrorState } from "@/components/primitives";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format/datetime";
import {
  SECTION_ASIDE,
  SETTINGS_SECTIONS,
  SETTING_FIELDS,
  savedValue,
  type SaveSettings,
  type SaveSourceSetting,
  type SettingValue,
} from "./fields";
import { SettingRow } from "./SettingRow";
import { SourceSettingsList } from "./SourceSettingsList";
import styles from "./Settings.module.css";

/**
 * The one Client Component on this route (CLAUDE.md §6).
 *
 * It holds the whole document rather than only the editable fields, and that is deliberate:
 * `PATCH /api/settings` answers with the *refreshed* document because a write moves things
 * the patch never named — `origin` flips to `user`, and `staggerMinutes.max` is recomputed
 * from the interval now in effect. Rendering the sections from a document the page fetched
 * once would leave the old bound on a control the user is about to use.
 *
 * **It batches.** One 저장, one request, one refreshed document. Sending each keystroke would
 * make the cross-field validator unusable: `stagger × 5 < interval × 60` is a statement about
 * a *pair*, and a user raising the stagger before shortening the interval would be refused
 * halfway through a change that is legal as a whole.
 */

export interface SettingsFormProps {
  readonly settings: SettingsDocument;
  readonly onSave: SaveSettings;
  readonly onToggleSource: SaveSourceSetting;
}

export function SettingsForm({ settings: initial, onSave, onToggleSource }: SettingsFormProps) {
  const [settings, setSettings] = useState<SettingsDocument>(initial);
  const [draft, setDraft] = useState<SettingsPatchRequest["changes"]>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const dirtyKeys = Object.keys(draft) as SettingKey[];
  const editableCount = SETTING_FIELDS.filter((field) => field.read(settings).editable).length;

  function change(key: SettingKey, value: SettingValue): void {
    setDraft((previous) => {
      // Typing the saved value back in is not a change. Left in the draft it would still be
      // sent, and the service would answer with `origin: "user"` — permanently marking a row
      // as personally changed when the user only changed their mind. Rebuilt rather than
      // deleted so the key never exists, which is also what the linter wants.
      if (savedValue(settings, key) === value) {
        return Object.fromEntries(
          Object.entries(previous).filter(([existing]) => existing !== key),
        );
      }
      return { ...previous, [key]: value };
    });
    setFailure(null);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setAnnouncement("");
    const result = await onSave(draft);
    setBusy(false);
    if (result.ok) {
      setSettings(result.settings);
      setDraft({});
      setAnnouncement("설정을 저장했어요.");
      return;
    }
    setFailure(result.message);
  }

  const toggleSource: SaveSourceSetting = async (platform, enabled) => {
    setBusy(true);
    setFailure(null);
    setAnnouncement("");
    const result = await onToggleSource(platform, enabled);
    setBusy(false);
    if (result.ok) {
      setSettings(result.settings);
      setAnnouncement("계정 설정을 저장했어요.");
    } else {
      setFailure(result.message);
    }
    return result;
  };

  function revert(): void {
    setDraft({});
    setFailure(null);
    setAnnouncement("바꾸던 값을 되돌렸어요.");
  }

  return (
    <>
      {SETTINGS_SECTIONS.map((section) => {
        const fields = SETTING_FIELDS.filter((field) => field.section === section.id);
        const aside = SECTION_ASIDE[section.id];
        const headingId = `settings-${section.id}`;
        return (
          <section key={section.id} className="settings-section" aria-labelledby={headingId}>
            <h2 id={headingId} className="type-section-title">
              {section.heading}
            </h2>
            <p className="type-body settings-lead">{section.description}</p>
            <ul className={styles.rows}>
              {fields.map((field) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  settings={settings}
                  draftValue={draft[field.key]}
                  onChange={change}
                  busy={busy}
                />
              ))}
            </ul>
            {aside === undefined ? null : (
              <p className={cx(styles.reason, "type-body-small")}>{aside}</p>
            )}
          </section>
        );
      })}

      <section className="settings-section" aria-labelledby="settings-sources">
        <h2 id="settings-sources" className="type-section-title">
          연결된 계정
        </h2>
        <p className="type-body settings-lead">
          수집기가 실제로 다녀온 계정입니다. 계정을 켜고 끄는 값과 별칭은 설정 파일에만 있고 아직
          아무 코드도 읽지 않아서, 지금은 상태만 보여드려요.
        </p>
        <SourceSettingsList sources={settings.sources} onToggle={toggleSource} busy={busy} />
      </section>

      <p className={cx(styles.reason, "type-body-small")}>
        이 값들은 {formatDateTime(settings.generatedAt)} 기준입니다. 바꿀 수 있는 값은 전체{" "}
        {SETTING_FIELDS.length}개 중 {editableCount}개예요.
      </p>

      {editableCount === 0 ? null : (
        <div className={styles.saveBar}>
          <p className={cx(styles.saveSummary, "type-body-small")} role="status" aria-live="polite">
            {failure !== null
              ? "저장하지 못했어요."
              : dirtyKeys.length > 0
                ? `${dirtyKeys.length.toLocaleString("ko-KR")}개를 바꿨어요. 아직 저장하지 않았습니다.`
                : announcement === ""
                  ? "바꾼 값이 없어요."
                  : announcement}
          </p>
          <Button
            variant="secondary"
            icon={Undo2}
            disabled={busy || dirtyKeys.length === 0}
            onClick={revert}
          >
            되돌리기
          </Button>
          <Button
            variant="primary"
            icon={Save}
            loading={busy}
            loadingLabel="저장하는 중"
            disabled={dirtyKeys.length === 0}
            onClick={() => {
              void save();
            }}
          >
            저장
          </Button>
        </div>
      )}

      {failure === null ? null : (
        <div className={styles.saveError}>
          <ErrorState
            live
            as="p"
            title="설정을 저장하지 못했어요"
            description={failure}
            centered={false}
          />
        </div>
      )}
    </>
  );
}
