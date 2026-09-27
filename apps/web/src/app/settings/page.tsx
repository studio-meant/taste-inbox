import type { Metadata } from "next";
import { THEMES } from "@taste-inbox/ui/theme";
import { FoundationStatus } from "@/components/foundation/FoundationStatus";
import { ThemePreviewGrid } from "@/components/foundation/ThemePreviewGrid";
import { AccountsSection } from "@/components/settings/AccountsSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { LaunchdPanel, type LaunchdPanelData } from "@/components/system/LaunchdPanel";
import { ThemePicker } from "@/components/theme/ThemePicker";
import {
  ApiDataError,
  getRepository,
  resolveDataSource,
  type TasteInboxRepository,
} from "@/lib/repository";
import { isRemoteReadOnly, REMOTE_READ_ONLY_MESSAGE } from "@/lib/remote-mode";
import {
  collectAccountNow,
  connectAccount,
  disconnectAccount,
  saveProfileName,
  saveSettings,
} from "./actions";
import "./settings.css";
import "./system.css";

export const metadata: Metadata = { title: "Settings · Taste Inbox" };

/**
 * Settings — everything about how this Mac is set up, on one page (2026-09-28).
 *
 * It used to be two: System (the Mac, the themes, the launchd plan) and Settings (the
 * configuration), with the only way into Settings a link on System. The order now follows
 * what a person comes here to do: say whose signals to collect, then how often, then how it
 * looks, then — for when something seems off — what this Mac is and what runs on it.
 */

async function loadLaunchdPlan(repository: TasteInboxRepository): Promise<LaunchdPanelData> {
  try {
    return { ok: true, plan: await repository.getLaunchdPlan() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ApiDataError ? error.message : "알 수 없는 이유로 실패했어요.",
    };
  }
}

export default async function SettingsPage() {
  const repository = getRepository();
  const dataSource = resolveDataSource();
  const readOnly = isRemoteReadOnly();

  const [hostProfile, resourcePolicy, boardCounts, jobs, launchd, settings, accounts, profile] =
    await Promise.all([
      repository.getHostProfile(),
      repository.getResourcePolicy(),
      repository.getBoardCounts(),
      repository.listJobs(),
      loadLaunchdPlan(repository),
      readOnly ? Promise.resolve(null) : repository.getSettings(),
      readOnly ? Promise.resolve(null) : repository.getAccounts(),
      readOnly ? Promise.resolve(null) : repository.getProfile(),
    ]);

  return (
    <>
      <header className="settings-header">
        <h1 className="type-page-title">Settings</h1>
        <p className="type-body settings-lead">
          {readOnly
            ? REMOTE_READ_ONLY_MESSAGE
            : "누구의 신호를 모을지, 얼마나 자주 모을지, 어떻게 보일지를 여기서 정해요. 아래에는 이 Mac의 상태가 있어요."}
        </p>
      </header>

      {profile === null ? null : (
        <ProfileSection name={profile.name ?? ""} onSave={saveProfileName} />
      )}

      {accounts === null ? null : (
        <AccountsSection
          accounts={accounts.accounts}
          onConnect={connectAccount}
          onDisconnect={disconnectAccount}
          onCollect={collectAccountNow}
        />
      )}

      {settings === null ? null : <SettingsForm settings={settings} onSave={saveSettings} />}

      <section className="system-section" aria-labelledby="themes-heading">
        <h2 id="themes-heading" className="type-section-title">
          테마
        </h2>
        <p className="type-body system-lead">
          테마는 {THEMES.length}종이고 기본값은 <strong>Meadow Cream</strong>입니다. 고른 테마는 이
          브라우저에만 저장돼요.
        </p>
        <ThemePicker />
        <details className="system-theme-ramps">
          <summary className="type-body-small">각 테마의 색 값 보기</summary>
          <ThemePreviewGrid themes={THEMES} />
        </details>
      </section>

      <FoundationStatus
        dataSource={dataSource}
        hostProfile={hostProfile}
        resourcePolicy={resourcePolicy}
        aiItemCount={boardCounts.ai}
        styleItemCount={boardCounts.style}
        jobs={jobs}
      />

      <LaunchdPanel data={launchd} dataSource={dataSource} />
    </>
  );
}
