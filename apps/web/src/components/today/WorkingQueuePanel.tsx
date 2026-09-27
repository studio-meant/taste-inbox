import type { QueueItem, QueueItemKind, TodayPayload } from "@taste-inbox/shared";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Key,
  Loader,
  Eye,
  Tag,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { CardSurface, EmptyState } from "@/components/primitives";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";
import { toUrlObject } from "@/lib/filters/board-filters";

/**
 * Working Queue — PAGE_SPECIFICATIONS §5.2, laid out as the reference's `WorkingCard`
 * (ref.js:495):
 *
 *   Working Queue                                                          ( ◐ )
 *   [✓]  Garden Lens
 *        준비 완료 · 환경 열기
 *   ──────────────────────────────────────────────────────────────────────────
 *   [◷]  Cropped shell jacket
 *        가격 확인 중 · 가격 확인 중
 *        ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░
 *   ──────────────────────────────────────────────────────────────────────────
 *   시스템 상태 열기 →                              [ 준비됨 2 ] [ 확인 필요 1 ]
 *
 * Each row still reads 상태 → 대상 → 다음 단계, because the user is scanning for
 * "무엇이 나를 기다리는가". What changed is where the state sits: the reference gives it
 * a 25px icon tile and pushes the words into the row's second line, so the Korean status
 * label moved there rather than being deleted — the state is still text, never colour
 * alone (CLAUDE.md §6).
 *
 * The reference's own three rows are dead features (repo sandbox, price matching), so
 * only the row *shape* is ported; the rows are whatever the queue actually holds.
 *
 * The allowed row kinds are exactly the six PAGE_SPECIFICATIONS lists; a seventh would
 * need a document change.
 */

type QueueTone = "neutral" | "ready" | "active";

interface QueueKindPresentation {
  readonly label: string;
  readonly tone: QueueTone;
  readonly icon: LucideIcon;
}

const QUEUE_KIND: Readonly<Record<QueueItemKind, QueueKindPresentation>> = {
  environment_ready: { label: "준비 완료", tone: "ready", icon: Check },
  environment_preparing: { label: "빌드 중", tone: "active", icon: Loader },
  token_required: { label: "토큰 필요", tone: "neutral", icon: Key },
  review_required: { label: "승인 필요", tone: "neutral", icon: Eye },
  price_checking: { label: "가격 확인 중", tone: "active", icon: Tag },
  collector_auth: { label: "로그인 필요", tone: "neutral", icon: CircleAlert },
};

const TONE_CLASS: Readonly<Record<QueueTone, string | undefined>> = {
  neutral: undefined,
  ready: styles.queueCheckReady,
  active: styles.queueCheckActive,
};

/**
 * `.mini-progress` — ref.css:268: a bare 4px bar with no label and no value line.
 *
 * `Meter` is the product's measurement primitive and would be the right thing to use,
 * but it has no compact variant and it lives in `components/primitives`, which this
 * change does not own. Until `Meter` gains one, the bar carries the same accessible
 * contract itself: `role="meter"`, a name, and a value a screen reader can read.
 */
function MiniProgress({ label, ratio }: { readonly label: string; readonly ratio: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <span
      className={styles.miniProgress}
      role="meter"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${String(percent)}%`}
    >
      <span
        className={styles.miniProgressFill}
        style={{ ["--progress" as string]: `${String(percent)}%` }}
      />
    </span>
  );
}

export function WorkingQueuePanel({
  items,
  counts,
}: {
  readonly items: readonly QueueItem[];
  /**
   * Today's headline figures. The reference has no counts row of its own, so they sit
   * in the footer beside the text action rather than crowding the page header.
   */
  readonly counts?: TodayPayload["counts"];
}) {
  return (
    <CardSurface
      as="section"
      tone="glass"
      radius="card"
      padding="none"
      className={cx(styles.overviewCard, styles.workingCard, styles.queue, styles.motionItem)}
      style={{ ["--i" as string]: "3" }}
      aria-labelledby="today-queue-heading"
    >
      <div className={styles.cardHeading}>
        <h2 id="today-queue-heading" className={styles.cardHeadingTitle} lang="en">
          Working Queue
        </h2>
        {/* `.queue-orbit` — ref.css:264. Two discs, purely ambient. */}
        <span className={styles.queueOrbit} aria-hidden="true">
          <i />
          <i />
        </span>
      </div>

      {items.length === 0 ? (
        <div className={styles.emptyBody}>
          <EmptyState
            as="h3"
            title="지금 기다리는 작업은 없어요"
            description="수집이나 정리할 일이 생기면 여기에 쌓입니다."
          />
        </div>
      ) : (
        <ul className={styles.queueList}>
          {items.map((item, index) => {
            const presentation = QUEUE_KIND[item.kind];
            const Icon = presentation.icon;
            return (
              <li
                key={item.id}
                className={styles.queueRow}
                style={{ ["--row" as string]: String(index) }}
              >
                <Link href={toUrlObject(item.href)} className={styles.queueLink}>
                  <span
                    className={cx(styles.queueCheck, TONE_CLASS[presentation.tone])}
                    aria-hidden="true"
                  >
                    <Icon strokeWidth={1.75} focusable="false" />
                  </span>
                  <span className={styles.queueCopy}>
                    <span className={styles.queueTarget}>{item.target}</span>
                    {/* 상태 and 다음 단계 on one line, as the reference's `small`. */}
                    <span className={styles.queueMeta}>
                      <span>{presentation.label}</span>
                      {item.nextStep === presentation.label ? null : (
                        <>
                          {" · "}
                          <span>{item.nextStep}</span>
                        </>
                      )}
                    </span>
                    {item.progress === null ? null : (
                      <MiniProgress label={`${item.target} 진행률`} ratio={item.progress} />
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.queueFooter}>
        {/* `.text-action` — ref.css:269, in Korean. */}
        <Link href="/system" className={styles.textAction}>
          시스템 상태 열기
          <ArrowRight strokeWidth={1.75} aria-hidden="true" focusable="false" />
        </Link>

        {counts === undefined ? null : (
          <ul className={styles.queueCounts} aria-label="오늘 요약">
            <li className={cx(styles.tag, styles.tagGreen)}>
              {`준비됨 ${counts.readyActions.toLocaleString("ko-KR")}`}
            </li>
            {counts.attention > 0 ? (
              <li className={cx(styles.tag, styles.tagWarm)}>
                {`확인 필요 ${counts.attention.toLocaleString("ko-KR")}`}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </CardSurface>
  );
}
