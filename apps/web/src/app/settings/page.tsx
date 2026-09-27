import type { Metadata } from "next";
import { ABSENT_FEATURE_NOTES } from "@/components/settings/fields";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { getRepository } from "@/lib/repository";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";
import { saveSettings, saveSourceSetting } from "./actions";
import "./settings.css";

export const metadata: Metadata = { title: "Settings · Taste Inbox" };

/**
 * Settings — PAGE_SPECIFICATIONS.md §11.
 *
 * A Server Component that fetches once and hands the document to one Client Component
 * (CLAUDE.md §6). Everything interactive lives in `SettingsForm`; the page itself is the
 * heading, the lead, and the two Server Actions.
 *
 * **Smaller than the spec, on purpose.** §11 lists six sections, and most of what it names
 * has no state behind it in this build: ceremonial entry needs a Splash that does not exist,
 * personalization-signal ranking needs a ranker that does not exist, and price-change
 * notifications need the product resolution that decision #3 deliberately removed
 * (docs/DECISIONS.md, 2026-08-09). Rendering those as switches would be five controls that
 * change nothing, which is worse than not offering them — so the sections that do not exist
 * say so in a sentence instead.
 */
export default async function SettingsPage() {
  if (isRemoteReadOnly()) {
    return (
      <header className="settings-header">
        <h1 className="type-page-title">Settings</h1>
        <p className="type-body settings-lead">{REMOTE_READ_ONLY_MESSAGE}</p>
      </header>
    );
  }
  const settings = await getRepository().getSettings();

  return (
    <>
      <header className="settings-header">
        <h1 className="type-page-title">Settings</h1>
        <p className="type-body settings-lead">
          바꾼 값과 기본값을 구분해서 보여줍니다. 각 설정이 언제부터 적용되는지도 함께 적혀 있어요.
        </p>
      </header>

      <SettingsForm settings={settings} onSave={saveSettings} onToggleSource={saveSourceSetting} />

      {/*
        Rendered here rather than inside the form because none of it is interactive, and a
        Client Component should not ship eight paragraphs of static prose to the browser
        (CLAUDE.md §6). `role="note"` so a screen reader announces the region as an aside
        rather than as another group of settings the user failed to find controls in.
      */}
      <section className="settings-section" aria-labelledby="settings-absent">
        <h2 id="settings-absent" className="type-section-title">
          아직 없는 설정
        </h2>
        <p className="type-body settings-lead">
          명세에는 있지만 뒤에 아무 상태도 없는 항목들이에요. 켜고 꺼도 달라지는 게 없는 스위치를
          두는 대신, 왜 없는지 적어 둡니다.
        </p>
        <ul className="settings-absent-list" role="note" aria-label="아직 없는 설정">
          {ABSENT_FEATURE_NOTES.map((note) => (
            <li key={note.heading}>
              <p className="type-body settings-absent-heading">{note.heading}</p>
              <p className="type-body-small settings-absent-body">{note.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
