"use client";

import type { Account, AccountPlatform } from "@taste-inbox/shared";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, StatusPill } from "@/components/primitives";
import { RefreshWhileRunning } from "@/components/shell/RefreshWhileRunning";
import { SourceMark } from "@/components/today/SourceMark";
import { formatRelative } from "@/lib/format/datetime";
import styles from "./AccountsSection.module.css";

/**
 * The top of Settings: which GitHub and Hugging Face account this Mac reads.
 *
 * One card per platform, because they are separate answers — a person may have only one of
 * the two, and connecting one must not look like it is waiting on the other. A name is all
 * either needs (`github.com/ohsuz` → `ohsuz`); saving it collects at once, and after that the
 * interval below decides.
 *
 * Tokens are named here and never entered here. The card says whether one is set and what
 * it changes; the value stays in `.env`.
 */

type Action = (
  platform: AccountPlatform,
  handle: string,
) => Promise<{ ok: boolean; message: string }>;
type PlatformAction = (platform: AccountPlatform) => Promise<{ ok: boolean; message: string }>;

const WHAT_IT_COLLECTS: Readonly<Record<AccountPlatform, string>> = {
  github: "별(Star)을 누른 저장소를 모아요.",
  huggingface: "좋아요한 모델·데이터셋·Space와, 업보트한 논문을 모아요.",
};

const PREFIX: Readonly<Record<AccountPlatform, string>> = {
  github: "github.com/",
  huggingface: "huggingface.co/",
};

const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  ok: "정상",
  empty: "새 항목 없음",
  failed: "실패",
  rate_limited: "요청 한도에 걸림",
  auth_required: "권한 필요",
  blocked: "막힘",
};

export function AccountsSection({
  accounts,
  onConnect,
  onDisconnect,
  onCollect,
}: {
  readonly accounts: readonly Account[];
  readonly onConnect: Action;
  readonly onDisconnect: PlatformAction;
  readonly onCollect: PlatformAction;
}) {
  const moving = accounts.some(
    (account) => account.job !== null && ["queued", "running"].includes(account.job.state),
  );
  return (
    <section className={styles.section} aria-labelledby="settings-accounts">
      {moving ? <RefreshWhileRunning /> : null}
      <h2 id="settings-accounts" className="type-section-title">
        계정
      </h2>
      <p className={styles.lead}>
        GitHub와 Hugging Face에 남긴 신호를 모아요. 모두 공개 정보라 로그인 없이 계정명만 있으면
        돼요.
      </p>
      <div className={styles.grid}>
        {accounts.map((account) => (
          <AccountCard
            key={account.platform}
            account={account}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onCollect={onCollect}
          />
        ))}
      </div>
    </section>
  );
}

function AccountCard({
  account,
  onConnect,
  onDisconnect,
  onCollect,
}: {
  readonly account: Account;
  readonly onConnect: Action;
  readonly onDisconnect: PlatformAction;
  readonly onCollect: PlatformAction;
}) {
  const [value, setValue] = useState(account.handle ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const inputId = `account-${account.platform}`;
  const running = account.job !== null && ["queued", "running"].includes(account.job.state);
  const dirty = value.trim() !== (account.handle ?? "");

  const run = (work: () => Promise<{ ok: boolean; message: string }>) => {
    startTransition(async () => {
      setResult(await work());
    });
  };

  return (
    <article className={styles.card} aria-labelledby={`${inputId}-title`}>
      <header className={styles.head}>
        <h3 id={`${inputId}-title`} className={styles.title}>
          <SourceMark platform={account.platform} size={18} />
          {account.label}
        </h3>
        {account.handle === null ? (
          <StatusPill tone="neutral">연결 안 됨</StatusPill>
        ) : running ? (
          <StatusPill tone="info">수집 중</StatusPill>
        ) : (
          <StatusPill tone="ready">연결됨</StatusPill>
        )}
      </header>
      <p className={styles.what}>{WHAT_IT_COLLECTS[account.platform]}</p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          run(() => onConnect(account.platform, value));
        }}
      >
        <label htmlFor={inputId} className={styles.label}>
          계정명
        </label>
        <div className={styles.field}>
          <span className={styles.prefix} aria-hidden="true">
            {PREFIX[account.platform]}
          </span>
          <input
            id={inputId}
            className={styles.input}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            placeholder="ohsuz"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${inputId}-help`}
          />
          <Button
            type="submit"
            variant="primary"
            compact
            loading={pending}
            loadingLabel="저장 중"
            disabled={!dirty || value.trim() === ""}
          >
            {account.handle === null ? "연결" : "저장"}
          </Button>
        </div>
        <p id={`${inputId}-help`} className={styles.help}>
          프로필 주소를 붙여 넣어도 돼요. 저장하면 바로 한 번 수집해요.
        </p>
      </form>

      {account.handle === null ? null : (
        <>
          <ul className={styles.surfaces} aria-label={`${account.label} 수집 상태`}>
            {account.surfaces.map((surface) => (
              <li key={surface.id}>
                <span className={styles.surfaceLabel}>{surface.label}</span>
                <span className={styles.surfaceState}>
                  {surface.lastRunAt === null
                    ? "아직 수집 전"
                    : `${formatRelative(surface.lastRunAt)} · ${OUTCOME_LABEL[surface.outcome ?? ""] ?? surface.outcome ?? ""}${
                        surface.outcome === "ok" && surface.itemsSeen !== null
                          ? ` · ${String(surface.itemsSeen)}개 확인`
                          : ""
                      }`}
                </span>
                {surface.outcome !== null && surface.outcome !== "ok" && surface.stoppedBecause ? (
                  <span className={styles.surfaceWhy}>{surface.stoppedBecause}</span>
                ) : null}
              </li>
            ))}
          </ul>

          {running && account.job !== null ? (
            <ol className={styles.steps} aria-label="진행 중인 수집">
              {account.job.steps.map((step) => (
                <li key={step.label} data-state={step.state}>
                  {step.label} · {STEP_LABEL[step.state]}
                </li>
              ))}
            </ol>
          ) : null}

          <div className={styles.actions}>
            <Button
              variant="secondary"
              compact
              icon={RefreshCw}
              disabled={running || pending}
              onClick={() => {
                run(() => onCollect(account.platform));
              }}
            >
              지금 수집
            </Button>
            {account.profileUrl === null ? null : (
              <a
                className={styles.profile}
                href={account.profileUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                프로필
                <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                <span className="visually-hidden">(새 탭에서 열림)</span>
              </a>
            )}
            <Button
              variant="ghost"
              compact
              disabled={running || pending}
              onClick={() => {
                run(() => onDisconnect(account.platform));
              }}
            >
              연결 해제
            </Button>
          </div>
        </>
      )}

      <p className={styles.token}>
        {account.tokenConfigured
          ? `${account.tokenEnv} 사용 중`
          : `토큰 없음 — ${account.tokenEffect}. 쓰려면 .env의 ${account.tokenEnv}에 넣어 주세요.`}
      </p>

      {result === null ? null : (
        <p className={result.ok ? styles.ok : styles.error} role={result.ok ? "status" : "alert"}>
          {result.message}
        </p>
      )}
    </article>
  );
}

const STEP_LABEL = {
  waiting: "대기",
  running: "진행 중",
  done: "완료",
  failed: "실패",
  skipped: "건너뜀",
} as const;
