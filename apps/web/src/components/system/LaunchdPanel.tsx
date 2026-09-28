import type { LaunchdPlan } from "@taste-inbox/shared";
import { EmptyState, ErrorState } from "@/components/primitives";
import { blockText, splitCommandBlocks } from "./commands";
import { CopyCommands } from "./CopyCommands";

/**
 * The generated launchd jobs, and the commands a person runs to load them — IA §7.10's
 * ScheduleList, arriving because Settings had been pointing here since before it existed.
 *
 * `components/settings/fields.ts` tells anyone who changes the collection interval that the
 * reinstall commands are on this screen. They were not: `/api/collection/launchd` had
 * generated them correctly for weeks and had no consumer anywhere in `apps/web`. This panel
 * is that consumer, and `LAUNCHD_SECTION_HEADING` is the name that sentence now points at.
 *
 * **This panel shows. It never runs.** No button installs, nothing fetches an install, and
 * nothing in this product executes `launchctl` — `docs/DECISIONS.md` 2026-08-08 ("launchd
 * jobs are generated, never installed") and 2026-08-10 ("이 저장소의 어떤 코드도 launchctl을
 * 실행하지 않으며, 그건 그대로 둔다"). The reason is in the copy rather than only in this
 * comment, because it is the user's decision and they cannot read comments: loading these
 * jobs points six timers at four logged-in accounts, which CLAUDE.md §10 keeps behind
 * explicit human action. The one affordance here copies text to the clipboard.
 *
 * A Server Component. The single Client Component is the copy button.
 */

export const LAUNCHD_SECTION_HEADING = "수집 작업 등록";

/**
 * Loaded, or not — and "not" is an ordinary outcome rather than a page failure.
 *
 * Everything else System renders is still true when the service is down, and `/system` has
 * no local `error.tsx`, so a throw from this one fetch would take the whole document to the
 * root boundary. The page catches instead and hands the message here.
 */
export type LaunchdPanelData =
  | { readonly ok: true; readonly plan: LaunchdPlan }
  | { readonly ok: false; readonly message: string };

export interface LaunchdPanelProps {
  readonly data: LaunchdPanelData;
  /**
   * Mock mode cannot know this Mac's repository path, so the commands it renders name a
   * placeholder. Saying so is the difference between an example and a command that quietly
   * points at nothing.
   */
  readonly dataSource: "mock" | "live";
}

export function LaunchdPanel({ data, dataSource }: LaunchdPanelProps) {
  return (
    <section className="system-section" aria-labelledby="launchd-heading">
      <h2 id="launchd-heading" className="type-section-title">
        {LAUNCHD_SECTION_HEADING}
      </h2>
      <p className="type-body system-lead">
        수집을 정해진 간격으로 돌리려면 아래 명령을 터미널에서 직접 실행해야 합니다. 이 화면은
        명령을 만들어 보여줄 뿐이고, 등록도 해제도 하지 않아요.
      </p>
      <p className="system-note type-body-small" role="note">
        <strong>참고</strong> — 등록한 작업은 로그인된 계정 네 곳을 정해진 간격으로 엽니다. 계정을
        여는 일은 사람이 명령을 읽고 실행할 때만 시작되어야 해서, 이 자리에 버튼을 두지 않았습니다.
      </p>

      {data.ok ? <Loaded plan={data.plan} dataSource={dataSource} /> : <Failed data={data} />}
    </section>
  );
}

function Failed({ data }: { readonly data: Extract<LaunchdPanelData, { ok: false }> }) {
  return (
    <ErrorState
      as="h3"
      title="등록 명령을 불러오지 못했어요."
      description="로컬 서비스가 실행 중인지 확인한 뒤 이 화면을 다시 열어 주세요. 이미 등록해 둔 작업은 이 화면과 상관없이 그대로 돌아갑니다."
      // The service's own Korean sentence, collapsed. The copy above is written from the
      // situation; this says which failure it was (primitives/ErrorState).
      detail={data.message}
    />
  );
}

function Loaded({
  plan,
  dataSource,
}: {
  readonly plan: LaunchdPlan;
  readonly dataSource: "mock" | "live";
}) {
  const blocks = splitCommandBlocks(plan.commands);

  if (plan.jobs.length === 0 || blocks.length === 0) {
    return (
      <EmptyState
        as="h3"
        title="등록할 작업이 없어요."
        description="수집기가 하나도 켜져 있지 않으면 만들 작업도 없습니다."
      />
    );
  }

  return (
    <>
      {dataSource === "mock" ? (
        <p className="system-note type-body-small" role="note">
          <strong>Mock 데이터</strong> — 아래 경로는 예시입니다. 실제 명령을 보려면 로컬 서비스에
          연결된 상태에서 이 화면을 여세요.
        </p>
      ) : null}

      <ol className="launchd-jobs" aria-label="등록할 작업">
        {plan.jobs.map((job) => (
          <li key={job.label} className="launchd-job">
            {/*
              The label, not the path. `jobs[].path` arrives repo-relative while the path
              inside the command is absolute, and only the absolute one works when pasted —
              showing both would print two different strings for one file. The label is what
              `launchctl bootout` names, so it is also the string worth recognising.
            */}
            <span className="launchd-job-label type-mono">{job.label}</span>
            {/*
              `runsAt` is a Korean cadence sentence — "4시간마다", "4시간마다 (+3분)" — and
              never a timestamp: `StartInterval` counts from when a job is loaded, so these
              jobs have no clock time to name. Not a date to format.
            */}
            <span className="launchd-job-cadence type-body-small">{job.runsAt}</span>
          </li>
        ))}
      </ol>

      {blocks.map((block) => (
        <div className="launchd-block" key={block.id}>
          <div className="launchd-block-head">
            <h3 className="type-card-title">{block.heading}</h3>
            <CopyCommands text={blockText(block)} blockName={block.heading} />
          </div>
          {/*
            Focusable and named, because it scrolls: a wide command line has to scroll
            inside this box rather than moving the page sideways, and a scroll container a
            keyboard cannot reach is a box some people cannot read the end of.

            Rendered verbatim. `$(id -u)` is literal shell that must arrive unexpanded, and
            the two forms differ on purpose — `bootstrap gui/$(id -u) <path>` with a space,
            `bootout gui/$(id -u)/<label>` with a slash.
          */}
          <pre
            className="launchd-commands type-mono"
            role="region"
            aria-label={`${block.heading} 명령`}
            tabIndex={0}
          >
            {blockText(block)}
          </pre>
        </div>
      ))}

      <p className="system-note type-body-small" role="note">
        <strong>간격을 바꾼 뒤에는</strong> — Settings에서 수집 간격이나 수집기 사이 간격을 바꿔도,
        이미 등록된 작업은 등록할 때의 간격 그대로 계속 돕니다. 새 값은 위 명령이 가리키는 파일에
        이미 적혀 있으니, 해제한 뒤 다시 등록해야 실제로 바뀌어요. 등록한 직후에는 수집하지 않고 한
        간격 뒤부터 시작합니다.
      </p>
    </>
  );
}
