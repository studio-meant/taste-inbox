import { SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { THEMES } from "@taste-inbox/ui/theme";
import { FoundationStatus } from "@/components/foundation/FoundationStatus";
import { ThemePreviewGrid } from "@/components/foundation/ThemePreviewGrid";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { LaunchdPanel, type LaunchdPanelData } from "@/components/system/LaunchdPanel";
import {
  ApiDataError,
  getRepository,
  resolveDataSource,
  type TasteInboxRepository,
} from "@/lib/repository";
import "./system.css";

export const metadata: Metadata = { title: "System · Taste Inbox" };

/**
 * System — IA §7.10.
 *
 * The rest of the section (AttentionStack, CollectorGrid, AuthenticationList, JobList,
 * StorageOverview) arrives in a later phase. What lives here now is the Phase 0 foundation
 * status, which belongs in System by nature — it reports the detected host, the derived
 * resource policy and the storage budget — and §7.10's ScheduleList, which arrived early
 * because Settings had been telling people the launchd commands were on this screen while
 * this screen contained no reference to launchd at all.
 *
 * `FoundationStatus` wants two integers from the boards, so this asks for integers. It
 * used to fetch two full boards — and `listAIItems()` with no query took the default page
 * size, so the number on screen was `min(20, total)` rather than the board's size.
 */

/**
 * The launchd plan, or the reason there isn't one.
 *
 * Deliberately outside the `Promise.all` below. `/system` has no `error.tsx` of its own, so
 * it falls to the root boundary (`app/error.tsx`), which replaces the entire document
 * including the shell and the navigation. Letting one optional section do that to the host
 * profile, the resource policy and the theme grid would trade five true things for one
 * missing one. The panel renders its own failure instead.
 */
async function loadLaunchdPlan(repository: TasteInboxRepository): Promise<LaunchdPanelData> {
  try {
    return { ok: true, plan: await repository.getLaunchdPlan() };
  } catch (error) {
    return {
      ok: false,
      // `ApiDataError` already carries the service's Korean sentence — an unreachable
      // service, or a payload that did not match the contract. Anything else has no
      // user-facing wording of its own, and `error.message` on an unknown throw is as
      // likely to be an English stack fragment as a sentence.
      message: error instanceof ApiDataError ? error.message : "알 수 없는 이유로 실패했어요.",
    };
  }
}

export default async function SystemPage() {
  const repository = getRepository();
  const dataSource = resolveDataSource();

  const [hostProfile, resourcePolicy, boardCounts, jobs, launchd] = await Promise.all([
    repository.getHostProfile(),
    repository.getResourcePolicy(),
    repository.getBoardCounts(),
    repository.listJobs(),
    loadLaunchdPlan(repository),
  ]);

  return (
    <>
      <header className="system-header">
        <h1 className="type-page-title">System</h1>
        <p className="type-body system-lead">
          현재 이 Mac에서 감지한 하드웨어와, 거기서 계산한 리소스 한도입니다. 어떤 기기 사양도
          코드에 고정되어 있지 않습니다.
        </p>
        {/*
          The only way into Settings. `routes.ts` counts `/settings` as part of this
          destination, so the navigation was already treating it as reachable — but nothing
          linked to it, which made it a screen you could only reach by typing the URL.
        */}
        <Link href="/settings" className="type-body-small system-settings-link">
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          설정 열기
        </Link>
      </header>

      <FoundationStatus
        dataSource={dataSource}
        hostProfile={hostProfile}
        resourcePolicy={resourcePolicy}
        aiItemCount={boardCounts.ai}
        styleItemCount={boardCounts.style}
        jobs={jobs}
      />

      <LaunchdPanel data={launchd} dataSource={dataSource} />

      {/*
        Themes are chosen here.

        This section used to be a read-only showcase of all six, headed with a count. That
        was honest while nothing could change the theme; it is the wrong shape now that
        something can, so the section leads with the applied theme and the way to change it.
        `ThemePicker`'s own comment records why the control lives on System rather than in
        Settings or the context bar.

        The grid is kept, demoted into a disclosure and renamed for what it actually is: the
        resolved ramp values, which is design-QA reference material rather than a choice.
        It does not repeat the choice — the picker is the only place that offers one.
      */}
      <section className="system-section" aria-labelledby="themes-heading">
        <h2 id="themes-heading" className="type-section-title">
          테마
        </h2>
        <p className="type-body system-lead">
          테마는 {THEMES.length}종이고 기본값은 <strong>Meadow Cream</strong>입니다. 고른 테마는 이
          브라우저에만 저장되므로 다른 기기나 다른 브라우저에는 따라가지 않고, 설정 파일의 기본
          테마와도 별개의 값이에요.
        </p>
        <ThemePicker />

        <details className="system-theme-ramps">
          <summary className="type-body-small">각 테마의 색 값 보기</summary>
          <p className="type-body-small system-lead">
            연두–세이지–리프–포레스트, 크림–오트밀–라이트 우드 램프의 실제 값입니다. 화면을 바꾸지
            않고 값만 보여줍니다.
          </p>
          <ThemePreviewGrid themes={THEMES} />
        </details>
      </section>
    </>
  );
}
