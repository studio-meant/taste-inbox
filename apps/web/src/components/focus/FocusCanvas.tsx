import type { FocusJob, FocusPayload, SourceRef, TrialDenial } from "@taste-inbox/shared";
import { ArrowLeft, ExternalLink, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/primitives";
import { PaperBundleCard } from "@/components/paper/PaperBundleCard";
import { LabQueryDock } from "@/components/query/LabQueryDock";
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
  kindLabel,
} from "./focus-state";
import { ReportText } from "./ReportText";
import { ResearchButton } from "./ResearchButton";
import { TrySafely } from "./TrySafely";
import styles from "./FocusCanvas.module.css";

/**
 * The Lab — one item, what the docs say about it, what happened when we tried.
 *
 * `/focus/[itemId]`, PAGE_SPECIFICATIONS §6.1 (the 2026-09-28 `itemId` build) and
 * NVIDIA_HACKATHON_PLAN §6.1. The route and the components keep the name they were built
 * with; **Lab** is what a person reads, because that is the product's own word for the
 * place an interest becomes evidence (docs/next_step, 2026-09-28). Renaming the files
 * would cost a morning and buy a diff.
 *
 * A Server Component throughout: every panel is a statement read from one payload, and the
 * only client code is the composer, the two buttons that start work, and the re-read that
 * follows them (`RefreshWhileRunning`), mounted only while a job is moving.
 *
 * ── The one division this screen is organised around ────────────────────────────────
 *
 *   RESEARCH EVIDENCE  · What the docs say          ← AI-Q, citations intact
 *   OBSERVED EVIDENCE  · What happened when we tried ← OpenShell, exit codes and refusals
 *
 * They are never mixed and never styled alike. A claim found on the web and a result
 * observed in a sandbox are different kinds of fact, and the whole product is the distance
 * between them.
 *
 * **What this screen will not do** is draw a number nobody measured. The reference's
 * `Peak RAM 6.4GB · Disk 3.8GB · Port 7860` panel is replaced by what the sandbox itself
 * reported — its name, its policies, what it refused, how the run ended — and every panel
 * with nothing to say says so in words.
 */

/**
 * What the user did, from what they actually did.
 *
 * Keyed on `actionType`, not on the platform. Keyed on the platform it said 좋아요 for
 * every Hugging Face row, which stopped being true the day paper upvotes became their own
 * signal — an upvoted paper and a paper a liked model happens to cite are two different
 * claims about the person (`ingest/captures.py::API_SURFACES`).
 */
const ACTION_LABEL: Readonly<Record<NonNullable<SourceRef["actionType"]>, string>> = {
  star: "스타",
  like: "좋아요",
  upvote: "업보트",
  save: "저장",
  repost: "리포스트",
};

/** `GitHub 스타`, `Hugging Face 업보트`. The platform alone when the act was not recorded. */
function signalLabel(payload: FocusPayload): string {
  const platform = platformLabel(payload.item.platform);
  const action = payload.item.actionType;
  return action === null ? platform : `${platform} ${ACTION_LABEL[action]}`;
}

export function FocusCanvas({ payload }: { readonly payload: FocusPayload }) {
  const state = canvasState(payload);
  const { item } = payload;

  return (
    <article className={styles.page} data-focus-canvas data-dense-screen>
      {state.moving ? <RefreshWhileRunning /> : null}

      <div className={styles.toolbar}>
        <Link className={styles.back} href="/library">
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
          Inbox
        </Link>
        <p className={styles.toolbarLabel} lang="en">
          Lab · what the docs say · what happened when we tried
        </p>
      </div>

      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            <span className={styles.kindChip}>{kindLabel(item.kind)}</span>
            <span className={styles.source}>
              <SourceMark platform={item.platform} size={14} />
              {signalLabel(payload)}
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
        <div className={cx(styles.column, styles.columnFill)}>
          <WhyThisMatters payload={payload} />
          <ResearchPanel payload={payload} />
        </div>
        <div className={styles.column}>
          <QuestionPanel payload={payload} />
          <ActionPanel payload={payload} />
        </div>
      </div>

      {/*
        Full width, below both columns.

        It used to sit at the bottom of the right column, where it is by far the tallest
        panel on the screen — a transcript, a sandbox log and six facts — so the right
        column ran a page past the left and left the left half of the screen empty. It is
        also the panel this product exists for, and a stdout excerpt in a 400px column is
        the worst place to read one.
      */}
      <TrialPanel payload={payload} />

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
  eyebrow,
  title,
  titleLang,
  aside,
  children,
  className,
}: {
  readonly id: string;
  /**
   * Which kind of evidence this panel holds — `RESEARCH EVIDENCE`, `OBSERVED EVIDENCE`.
   *
   * English, small and above the title, because it is one of the product's own nouns and
   * the landing page uses the same words (docs/next_step §11). It is not decoration: it is
   * what stops a reader from taking a sentence AI-Q found on the web for something a
   * sandbox observed.
   */
  readonly eyebrow?: string;
  readonly title: string;
  readonly titleLang?: string;
  readonly aside?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cx(styles.panel, className)} aria-labelledby={id}>
      <div className={styles.panelHead}>
        <div>
          {eyebrow === undefined ? null : (
            <p className={styles.panelEyebrow} lang="en">
              {eyebrow}
            </p>
          )}
          <h2 id={id} className={styles.panelTitle} lang={titleLang}>
            {title}
          </h2>
        </div>
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
    <Panel
      id="focus-research"
      eyebrow="Research evidence · what the docs say"
      title="NVIDIA AI-Q 조사"
      aside={<JobPill job={job} />}
    >
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

/* ──────────────────────────────────────────── what do you want to know? */

/**
 * The half of the Lab only a person can start.
 *
 * Research first, then the question — that is the order the product is built in, and it is
 * why this panel says "조사를 먼저" rather than offering a field that would be refused. The
 * suggestions come from the item's own row (`action/questions.py`), the composer is the
 * dock this product has always had, and both end in the same POST.
 *
 * What it must never do is choose. An agent that picked the question would be answering a
 * question about a benchmark it invented, which is the failure this whole screen is
 * arranged against.
 */
function QuestionPanel({ payload }: { readonly payload: FocusPayload }) {
  const job = payload.jobs.plan;
  const planning = isActive(job);
  const failed = job?.steps.find((step) => step.state === "failed") ?? null;

  const disabledReason =
    payload.research === null
      ? "먼저 이 항목을 조사하면, 조사 결과를 바탕으로 질문을 제안해 드려요."
      : (payload.outbound.error ?? null);

  return (
    <Panel
      id="focus-question"
      eyebrow="What do you want to know?"
      title="무엇을 확인하고 싶으세요?"
      aside={<JobPill job={job} />}
    >
      {planning && job !== null ? <JobSteps job={job} /> : null}
      {!planning && job?.state === "failed" ? (
        <p className={styles.refusal} role="status">
          검증 설계가 끝나지 못했어요{failed?.message ? `: ${failed.message}` : "."} 질문은 그대로
          남아 있어요 — 다시 보내면 같은 질문으로 설계를 시도해요.
        </p>
      ) : null}

      <LabQueryDock
        itemId={payload.item.id}
        suggestions={payload.suggestedQuestions}
        asked={payload.asked}
        planning={planning}
        disabledReason={disabledReason}
      />
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

  /*
   * Whose idea this trial was. The two are different claims, and the panel says which:
   * `suggested` is AI-Q's own first step, offered before anyone asked for anything;
   * `question` is a check designed for something the person actually wanted to know.
   */
  const fromQuestion = suggestion?.origin === "question";

  return (
    <Panel
      id="focus-action"
      eyebrow={fromQuestion ? "Trial plan · your question" : "Suggested trial · AI-Q proposed it"}
      title={fromQuestion ? "질문 기반 Trial Plan" : "추천 검증 (Suggested Trial)"}
      className={styles.actionPanel}
    >
      {suggestion === null ? (
        <p className={styles.empty}>조사가 끝나면 가장 작은 검증 가능한 한 걸음이 여기 나와요.</p>
      ) : !suggestion.actionable ? (
        <p className={styles.empty}>
          리포트에 실행할 수 있는 구체적인 단계가 없었어요. 그래서 실행 버튼을 두지 않아요.
        </p>
      ) : (
        <>
          {fromQuestion && suggestion.plan.question !== null ? (
            <p className={styles.askedLine}>
              <span className={styles.label} lang="en">
                The agent turned your question into a trial
              </span>
              {suggestion.plan.question}
            </p>
          ) : null}
          <p className={styles.headline}>{suggestion.headline}</p>
          <dl className={styles.terms2}>
            {suggestion.plan.verificationGoal === null ? null : (
              <div>
                <dt lang="en">Verification goal</dt>
                <dd>{suggestion.plan.verificationGoal}</dd>
              </div>
            )}
            <div>
              {/* Named for what it is. Before a question it is this product's generic
                  "the thing started"; after one it is AI-Q's own criteria for the
                  question, and calling both 성공 조건 would hide that. */}
              <dt lang={suggestion.plan.acceptanceCriteria === null ? undefined : "en"}>
                {suggestion.plan.acceptanceCriteria === null ? "성공 조건" : "Acceptance criteria"}
              </dt>
              <dd>
                {/* AI-Q's own words when a question was asked, so it is rendered the way
                    every other piece of AI-Q text on this screen is: verbatim, line breaks
                    kept, URLs linked and nothing trimmed. */}
                <ReportText text={suggestion.plan.successCriteria} className={styles.criteria} />
              </dd>
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
    <Panel
      id="focus-trial"
      eyebrow="Observed evidence · what happened when we tried"
      title="샌드박스 실행 결과"
      aside={<JobPill job={job} />}
    >
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

/**
 * Interest signal → Research → Question → Trial plan → Execution → Evidence.
 *
 * Five steps rather than three, and the two new ones are the ones that make it a *trail*
 * rather than a pipeline diagram: a question somebody asked, and the plan an agent designed
 * for it. Every row is drawn from something that actually happened — a step with no time is
 * drawn as not reached, never as pending-but-assumed.
 */
function EvidenceTrail({ payload }: { readonly payload: FocusPayload }) {
  const { item, research, asked, trial, jobs } = payload;
  const trail: readonly { label: string; detail: string; at: string | null }[] = [
    {
      label: signalLabel(payload),
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
      label: "질문 · 사용자",
      detail: asked === null ? "아직 묻지 않음" : asked.question,
      at: asked?.askedAt ?? null,
    },
    {
      label: "검증 설계 · NVIDIA AI-Q",
      detail:
        asked?.report != null
          ? "검증 기준과 Trial Plan"
          : jobs.plan === null
            ? "아직 하지 않음"
            : JOB_STATE_LABEL[jobs.plan.state],
      at: asked?.observedAt ?? null,
    },
    {
      label: "샌드박스 실행 · OpenShell",
      detail: jobs.trial === null ? "아직 하지 않음" : JOB_STATE_LABEL[jobs.trial.state],
      at: trial?.observedAt ?? null,
    },
  ];
  return (
    <Panel id="focus-trail" title="Source Trail" titleLang="en">
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

  /*
   * One sentence over the rows, and only when there are rows to summarise.
   *
   * The ledger's value is that it names the actual host and the actual program, and that
   * stays below. What it was missing is the line a person can act on: which hosts, how
   * many attempts, and that the next run can be given them. Built from the rows rather
   * than written beside them, so it cannot say something the rows do not.
   */
  const attempts = denials.reduce((total, row) => total + (row.count ?? 1), 0);
  const hosts = [...new Set(denials.map((row) => row.host))];
  const summary =
    hosts.length === 0
      ? null
      : `${hosts.slice(0, 2).join(", ")}${hosts.length > 2 ? ` 외 ${String(hosts.length - 2)}곳` : ""} 접근이 현재 정책에서 차단됐어요 (시도 ${String(attempts)}회). 필요한 endpoint만 허용한 뒤 다시 실행할 수 있어요.`;

  return (
    <Panel
      id="focus-ledger"
      eyebrow="Observed evidence · the boundary, as it behaved"
      title="Policy Ledger"
      titleLang="en"
    >
      {summary === null ? null : (
        <p className={styles.ledgerSummary} role="status">
          <ShieldAlert size={15} strokeWidth={1.75} aria-hidden="true" />
          {summary}
        </p>
      )}
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
    <Panel
      id="focus-files"
      eyebrow="Observed evidence · left in the sandbox"
      title="Related Files"
      titleLang="en"
    >
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
