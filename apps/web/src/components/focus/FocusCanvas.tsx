import type { FocusJob, FocusPayload, SourcePlatform, TrialDenial } from "@taste-inbox/shared";
import { ArrowLeft, ExternalLink, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/primitives";
import { PaperBundleCard } from "@/components/paper/PaperBundleCard";
import { RefreshWhileRunning } from "@/components/shell/RefreshWhileRunning";
import { SourceMark } from "@/components/today/SourceMark";
import { platformLabel } from "@/components/collection/source-vocabulary";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format/datetime";
import {
  canvasState,
  isActive,
  JOB_STATE_LABEL,
  JOB_STATE_TONE,
  jobDuration,
  KIND_LABEL,
  kindLabel,
} from "./focus-state";
import { ReportText } from "./ReportText";
import { ResearchButton } from "./ResearchButton";
import { TrySafely } from "./TrySafely";
import styles from "./FocusCanvas.module.css";

/**
 * Focus Canvas — one item, the evidence around it, and the step it can take.
 *
 * `/focus/[itemId]`, PAGE_SPECIFICATIONS §6.1 (the 2026-09-28 `itemId` build) and
 * NVIDIA_HACKATHON_PLAN §6.1. A Server Component throughout: every panel is a statement
 * read from one payload, and the only client code is the two buttons that start work and
 * the re-read that follows it (`RefreshWhileRunning`), mounted only while a job is moving.
 *
 * **What this screen will not do** is draw a number nobody measured. The reference's
 * `Peak RAM 6.4GB · Disk 3.8GB · Port 7860` panel is replaced by what the sandbox itself
 * reported — its name, its policies, what it refused, how the run ended — and every panel
 * with nothing to say says so in words.
 */

const ACTION_LABEL: Readonly<Record<SourcePlatform, string>> = {
  github: "스타",
  huggingface: "좋아요",
  arxiv: "저장",
  threads: "리포스트",
  linkedin: "반응",
  instagram: "저장",
  web: "추가",
};

export function FocusCanvas({ payload }: { readonly payload: FocusPayload }) {
  const state = canvasState(payload);
  const { item } = payload;

  return (
    <article className={styles.page} data-focus-canvas>
      {state.moving ? <RefreshWhileRunning /> : null}

      <div className={styles.toolbar}>
        <Link className={styles.back} href={`/items/${item.id}`}>
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
          항목으로
        </Link>
        <p className={styles.toolbarLabel} lang="en">
          Focus Canvas · one item · connected evidence · prepared action
        </p>
      </div>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            <span className={styles.kindChip}>{KIND_LABEL[item.kind]}</span>
            <span className={styles.source}>
              <SourceMark platform={item.platform} size={14} />
              {platformLabel(item.platform)} {ACTION_LABEL[item.platform]}
              {item.actionAt === null ? null : (
                <>
                  {" · "}
                  <time dateTime={item.actionAt}>{formatDateTime(item.actionAt)}</time>
                </>
              )}
            </span>
          </p>
          <h1 className={cx(styles.title, "type-page-title")}>{item.title}</h1>
          {item.summary === null ? null : <p className={styles.summary}>{item.summary}</p>}
          <a
            className={styles.original}
            href={item.canonicalUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {platformLabel(item.platform)}에서 열기
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="visually-hidden">(새 탭에서 열림)</span>
          </a>
        </div>
        <div className={styles.heroState}>
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </div>
      </header>

      {payload.bundle === null ? null : <PaperBundleCard bundle={payload.bundle} />}

      <div className={styles.grid}>
        <div className={styles.column}>
          <WhyThisMatters payload={payload} />
          <ResearchPanel payload={payload} />
        </div>
        <div className={styles.column}>
          <ActionPanel payload={payload} />
          <TrialPanel payload={payload} />
        </div>
      </div>

      <div className={styles.lower}>
        <EvidenceTrail payload={payload} />
        <PolicyLedger payload={payload} />
        <Artifacts payload={payload} />
      </div>
    </article>
  );
}

function Panel({
  id,
  title,
  titleLang,
  aside,
  children,
  className,
}: {
  readonly id: string;
  readonly title: string;
  readonly titleLang?: string;
  readonly aside?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cx(styles.panel, className)} aria-labelledby={id}>
      <div className={styles.panelHead}>
        <h2 id={id} className={styles.panelTitle} lang={titleLang}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function JobPill({ job }: { readonly job: FocusJob | null }) {
  if (job === null) return null;
  return <StatusPill tone={JOB_STATE_TONE[job.state]}>{JOB_STATE_LABEL[job.state]}</StatusPill>;
}

/** Each step with its state in words. The failed step carries the run's own reason. */
function JobSteps({ job }: { readonly job: FocusJob }) {
  return (
    <ol className={styles.steps}>
      {job.steps.map((step) => (
        <li key={step.label} className={styles.step} data-state={step.state}>
          <span className={styles.stepState}>{STEP_LABEL[step.state]}</span>
          <span>
            {step.label}
            {step.message === null ? null : (
              <span className={styles.stepMessage}>{step.message}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

const STEP_LABEL = {
  waiting: "대기",
  running: "진행 중",
  done: "완료",
  failed: "실패",
  skipped: "건너뜀",
} as const;

/* ─────────────────────────────────────────────────────── why this matters */

function WhyThisMatters({ payload }: { readonly payload: FocusPayload }) {
  const context = payload.context;
  return (
    <Panel id="focus-why" title="Why this matters to you" titleLang="en">
      {context === null ? (
        <p className={styles.empty}>이 항목의 관심 맥락을 만들 수 없었어요.</p>
      ) : !context.grounded ? (
        <p className={styles.empty}>
          저장 이력에서 이 항목과 겹치는 주제를 찾지 못했어요. 조사 질문에도 연결이 없다고 적혀요.
        </p>
      ) : (
        <>
          {context.sharedTerms.length === 0 ? null : (
            <div className={styles.termBlock}>
              <p className={styles.label}>자주 저장하는 주제 중 겹치는 것</p>
              <ul className={styles.terms}>
                {context.sharedTerms.map((term) => (
                  <li key={term}>{term}</li>
                ))}
              </ul>
            </div>
          )}
          {context.neighbours.length === 0 ? null : (
            <div className={styles.termBlock}>
              <p className={styles.label}>이미 저장한 것 중 가까운 것</p>
              <ul className={styles.neighbours}>
                {context.neighbours.map((neighbour) => (
                  <li key={neighbour.itemId}>
                    <Link href={`/focus/${neighbour.itemId}`}>{neighbour.title}</Link>
                    <span className={styles.shared}>{neighbour.sharedTerms.join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {context === null || context.recentTotal === 0 ? null : (
        <p className={styles.footnote}>
          최근 30일 {context.recentTotal.toLocaleString("ko-KR")}개 저장 ·{" "}
          {Object.entries(context.recentKinds)
            .sort(([, a], [, b]) => b - a)
            .map(([kind, count]) => `${kindLabel(kind)} ${String(count)}`)
            .join(" · ")}
        </p>
      )}
    </Panel>
  );
}

/* ──────────────────────────────────────────────────────────────── research */

function ResearchPanel({ payload }: { readonly payload: FocusPayload }) {
  const job = payload.jobs.research;
  const research = payload.research;
  const outbound = payload.outbound;
  const failedStep = job?.steps.find((step) => step.state === "failed") ?? null;

  const destination =
    outbound.serverUrl === null
      ? null
      : `${outbound.serverUrl} (${outbound.local === true ? "이 기계" : "외부 서버"})`;

  return (
    <Panel id="focus-research" title="NVIDIA AI-Q 조사" aside={<JobPill job={job} />}>
      {isActive(job) && job !== null ? (
        <JobSteps job={job} />
      ) : job?.state === "failed" ? (
        <p className={styles.refusal} role="status">
          마지막 조사가 끝나지 못했어요{failedStep?.message ? `: ${failedStep.message}` : "."}
          {research === null ? null : " 아래는 그 전 조사 결과예요."}
        </p>
      ) : null}

      {research === null ? (
        isActive(job) ? null : (
          <>
            <p className={styles.lead}>
              이 항목을 조사하면 아래 질문이{" "}
              {destination === null ? "보내지지 않아요" : <strong>{destination}</strong>}
              {destination === null ? "." : "로 가요."} 개인 식별 정보 없이 주제·태그 요약과 공개
              식별자만 담겨요.
            </p>
            {outbound.query === null ? null : (
              <details className={styles.disclosure}>
                <summary>보낼 질문 원문 보기</summary>
                <pre className={styles.pre}>{outbound.query}</pre>
              </details>
            )}
            <ResearchButton
              itemId={payload.item.id}
              label="AI-Q로 조사하기"
              disabledReason={outbound.error}
            />
          </>
        )
      ) : (
        <>
          {/* No headline here. The stored one is from the run's own moment, and the action
              panel rebuilds the suggestion from this same report — two headlines for one
              report disagreed the first time the reader improved between runs. */}
          <p className={styles.footnote}>
            {research.observedAt === null ? null : (
              <>
                <time dateTime={research.observedAt}>{formatDateTime(research.observedAt)}</time>{" "}
                ·{" "}
              </>
            )}
            리포트 원문 — 인용과 URL을 자르지 않았어요
          </p>
          <ReportText text={research.report} className={styles.report} />
          {research.brief === null ? null : (
            <details className={styles.disclosure}>
              <summary>이 기계를 떠난 질문 보기</summary>
              <pre className={styles.pre}>{research.brief}</pre>
              {research.sourceUrl === null ? null : (
                <p className={styles.footnote}>보낸 곳: {research.sourceUrl}</p>
              )}
            </details>
          )}
          {isActive(job) ? null : (
            <ResearchButton
              itemId={payload.item.id}
              label="다시 조사하기"
              disabledReason={outbound.error}
            />
          )}
        </>
      )}
    </Panel>
  );
}

/* ───────────────────────────────────────────────────── action preview / try */

function ActionPanel({ payload }: { readonly payload: FocusPayload }) {
  const { suggestion, boundary } = payload;
  const trialRunning = isActive(payload.jobs.trial);

  const disabledReason = trialRunning
    ? "이 항목의 실행이 진행 중이에요."
    : boundary.busy
      ? "다른 실행이 샌드박스를 쓰고 있어요. 끝난 뒤 다시 시도해 주세요."
      : !boundary.ready
        ? `샌드박스 '${boundary.sandbox}'가 준비되지 않았어요${boundary.reason === null ? "." : `: ${boundary.reason}`}`
        : boundary.missingPresets.length > 0
          ? `필요한 정책 프리셋이 적용되지 않았어요: ${boundary.missingPresets.join(", ")}`
          : null;

  return (
    <Panel id="focus-action" title="다음 한 걸음" className={styles.actionPanel}>
      {suggestion === null ? (
        <p className={styles.empty}>조사가 끝나면 가장 작은 검증 가능한 한 걸음이 여기 나와요.</p>
      ) : !suggestion.actionable ? (
        <p className={styles.empty}>
          리포트에 실행할 수 있는 구체적인 단계가 없었어요. 그래서 실행 버튼을 두지 않아요.
        </p>
      ) : (
        <>
          <p className={styles.headline}>{suggestion.headline}</p>
          <dl className={styles.terms2}>
            <div>
              <dt>성공 조건</dt>
              <dd>{suggestion.plan.successCriteria}</dd>
            </div>
            <div>
              <dt>여는 곳</dt>
              <dd>
                {suggestion.plan.requiredHosts.length === 0
                  ? "없음"
                  : suggestion.plan.requiredHosts.join(", ")}
              </dd>
            </div>
            {suggestion.plan.refusedHosts.length === 0 ? null : (
              <div>
                <dt>열지 않는 곳</dt>
                <dd>
                  {suggestion.plan.refusedHosts.join(", ")}
                  <span className={styles.why}>
                    리포트가 언급했지만, 리포트는 경계를 넓힐 수 없어요.
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {suggestion.plan.commandsSeen.length === 0 ? null : (
            <details className={styles.disclosure}>
              <summary>리포트가 제시한 명령 {suggestion.plan.commandsSeen.length}개</summary>
              {suggestion.plan.commandsSeen.map((command) => (
                <pre key={command} className={styles.pre}>
                  {command}
                </pre>
              ))}
              <p className={styles.footnote}>
                에이전트는 이 명령을 그대로 실행하지 않고 의도를 따라요. 명령이 틀렸으면 실제
                진입점을 찾아 무엇을 바꿨는지 보고해요.
              </p>
            </details>
          )}
          <TrySafely
            itemId={payload.item.id}
            sandbox={boundary.sandbox}
            opens={suggestion.plan.requiredHosts}
            refused={suggestion.plan.refusedHosts}
            disabledReason={disabledReason}
          />
        </>
      )}
      <p className={styles.boundaryLine}>
        {boundary.ready ? (
          <ShieldCheck size={15} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <ShieldAlert size={15} strokeWidth={1.75} aria-hidden="true" />
        )}
        샌드박스 <code>{boundary.sandbox}</code> ·{" "}
        {boundary.busy ? "사용 중" : boundary.ready ? "준비됨" : "준비되지 않음"} · 적용한 프리셋{" "}
        {boundary.policies.length}개
      </p>
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────────── the run */

function TrialPanel({ payload }: { readonly payload: FocusPayload }) {
  const job = payload.jobs.trial;
  const trial = payload.trial;
  if (job === null && trial === null) return null;

  const facts = trial?.facts ?? {};
  const duration = jobDuration(job);
  const rows: readonly (readonly [string, string | undefined])[] = [
    ["종료 코드", facts.exit],
    ["도구 호출", facts.tools === undefined ? undefined : `${facts.tools}회`],
    ["도구 실패", facts.failures],
    ["멈춘 이유", facts.stop],
    ["소요 시간", duration ?? undefined],
    ["샌드박스", facts.sandbox],
  ];

  return (
    <Panel id="focus-trial" title="샌드박스 실행 결과" aside={<JobPill job={job} />}>
      {job === null ? null : <JobSteps job={job} />}
      {trial === null || isActive(job) ? null : (
        <>
          <dl className={styles.facts}>
            {rows
              .filter(([, value]) => value !== undefined)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {trial.transcript === null ? null : (
            <details className={styles.disclosure} open={job?.state !== "succeeded"}>
              <summary>에이전트가 보고한 것</summary>
              <ReportText text={trial.transcript} className={styles.report} />
            </details>
          )}
          {trial.errorOutput === null ? null : (
            <details className={styles.disclosure} open>
              <summary>샌드박스가 남긴 출력 (끝부분)</summary>
              <pre className={styles.pre}>{trial.errorOutput}</pre>
            </details>
          )}
          {trial.observedAt === null ? null : (
            <p className={styles.footnote}>
              기록: <time dateTime={trial.observedAt}>{formatDateTime(trial.observedAt)}</time>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/* ─────────────────────────────────────────────────────────── lower row */

function EvidenceTrail({ payload }: { readonly payload: FocusPayload }) {
  const { item, research, trial, jobs } = payload;
  const trail: readonly { label: string; detail: string; at: string | null }[] = [
    {
      label: `${platformLabel(item.platform)} ${ACTION_LABEL[item.platform]}`,
      detail: "당신이 남긴 신호",
      at: item.actionAt ?? item.firstSeenAt,
    },
    {
      label: "조사 · NVIDIA AI-Q",
      detail:
        research !== null
          ? "리포트와 인용"
          : jobs.research === null
            ? "아직 하지 않음"
            : JOB_STATE_LABEL[jobs.research.state],
      at: research?.observedAt ?? null,
    },
    {
      label: "샌드박스 실행 · OpenShell",
      detail: jobs.trial === null ? "아직 하지 않음" : JOB_STATE_LABEL[jobs.trial.state],
      at: trial?.observedAt ?? null,
    },
  ];
  return (
    <Panel id="focus-trail" title="Source trail" titleLang="en">
      <ol className={styles.trail}>
        {trail.map((step) => (
          <li key={step.label} data-reached={step.at !== null}>
            <span className={styles.trailLabel}>{step.label}</span>
            <span className={styles.trailDetail}>
              {step.detail}
              {step.at === null ? null : (
                <>
                  {" · "}
                  <time dateTime={step.at}>{formatDateTime(step.at)}</time>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function PolicyLedger({ payload }: { readonly payload: FocusPayload }) {
  const blocked = payload.trial?.blocked ?? [];
  const denials = payload.trial?.denials ?? [];
  const refused = payload.suggestion?.plan.refusedHosts ?? [];
  const endpoints = payload.boundary.endpoints;
  const hostCount = new Set(endpoints.flatMap((row) => row.hosts)).size;

  return (
    <Panel id="focus-ledger" title="Policy ledger" titleLang="en">
      <div className={styles.ledgerBlock}>
        <p className={styles.label}>실행 중 막힌 연결</p>
        {payload.trial === null ? (
          <p className={styles.empty}>아직 실행하지 않았어요.</p>
        ) : blocked.length === 0 ? (
          <p className={styles.empty}>막힌 연결 시도가 없었어요.</p>
        ) : (
          <ul className={styles.blocked}>
            {denials.map((row) => (
              <li key={`${row.host} ${row.binary ?? ""}`}>
                <ShieldAlert size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  {row.host}
                  {row.count === null ? null : (
                    <span className={styles.count}> · {row.count}회</span>
                  )}
                </span>
                <span className={styles.why}>{denialSentence(row)}</span>
                {row.binary === null ? null : <code className={styles.binary}>{row.binary}</code>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {refused.length === 0 ? null : (
        <div className={styles.ledgerBlock}>
          <p className={styles.label}>리포트가 언급했지만 열지 않은 곳</p>
          <p className={styles.hostList}>{refused.join(", ")}</p>
        </div>
      )}

      <details className={styles.disclosure}>
        <summary>
          허용된 연결{" "}
          {endpoints.length === 0
            ? "— 읽지 못했어요"
            : `${String(hostCount)}곳 · 정책 ${String(endpoints.length)}개 (기본 정책 포함)`}
        </summary>
        {endpoints.length === 0 ? (
          <p className={styles.empty}>
            샌드박스 상태에서 정책을 읽지 못했어요. 추측해서 그리지 않아요.
          </p>
        ) : (
          <ul className={styles.policies}>
            {endpoints.map((row) => (
              <li key={row.policy}>
                <code className={styles.policyName}>{row.policy}</code>
                <span>{row.hosts.join(", ") || "호스트 없음"}</span>
                <span className={styles.binaries}>
                  갈 수 있는 프로그램: {row.binaries.join(", ") || "없음"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.footnote}>
          같은 호스트라도 목록에 없는 프로그램은 막혀요. 예를 들어 huggingface 정책은 python3와
          node만 허용해서, curl로는 huggingface.co에 갈 수 없어요.
        </p>
      </details>
    </Panel>
  );
}

/**
 * Why the boundary said no, in a sentence. The two reasons OpenShell gives are different
 * findings — a host no policy opens, and a host that is open to other programs — and the
 * second is the one people do not expect.
 */
function denialSentence(row: TrialDenial): string {
  const reason = row.reason ?? "";
  const policy = /not allowed in policy '([^']+)'/.exec(reason);
  if (policy !== null) {
    return `이 호스트는 '${policy[1] ?? ""}' 정책에 열려 있지만, 이 프로그램에는 열려 있지 않아요.`;
  }
  if (reason.includes("not allowed by any policy")) {
    return "어느 정책도 이 호스트를 열지 않아요.";
  }
  return "실행 중에 연결하려다 정책에 막혔어요.";
}

function Artifacts({ payload }: { readonly payload: FocusPayload }) {
  const artifacts = payload.trial?.artifacts ?? [];
  return (
    <Panel id="focus-files" title="Related files" titleLang="en">
      {payload.trial === null ? (
        <p className={styles.empty}>실행하면 샌드박스 작업 폴더에 남은 파일이 여기 나와요.</p>
      ) : artifacts.length === 0 ? (
        <p className={styles.empty}>작업 폴더에 남은 파일이 없어요.</p>
      ) : (
        <ul className={styles.files}>
          {artifacts.map((name) => (
            <li key={name}>
              <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
              <code>{name}</code>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
