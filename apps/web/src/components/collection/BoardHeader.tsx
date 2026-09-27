import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/primitives";
import { cx } from "@/lib/cx";
import styles from "./Board.module.css";

/**
 * The header every Browse mode shares — `ref.js` `.browse-heading`.
 *
 * The reference's shape: an eyebrow, the board name, one summary line, and a tools cluster
 * on the opposite side of the same row. Its tools are `Today` / `All time` chips and a
 * board search, none of which exists here — so the slot is ported and filled with what the
 * board does know about itself.
 *
 * The `collected` flag is load-bearing rather than decorative: a board full of committed
 * seed data and a board full of the user's own saves look identical otherwise, and
 * mistaking one for the other while judging the product would be a real error.
 *
 * The unenriched notice is here for the same reason — DESIGN.md §3.5 requires the user
 * to be able to tell what has been checked from what has not.
 */
export function BoardHeader({
  title,
  lead,
  total,
  collected,
  unenrichedNote,
  actions,
}: {
  readonly title: string;
  readonly lead: string;
  readonly total: number;
  readonly collected: boolean;
  /** Omit when the board needs no explanatory strip beneath its heading. */
  readonly unenrichedNote?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headingRow}>
        <div className={styles.headingText}>
          <span className={cx(styles.eyebrow, "type-label")}>내 컬렉션</span>
          <h1 className={cx(styles.title, "type-page-title")} lang="en">
            {title}
          </h1>
          <p className={cx(styles.lead, "type-body")}>{lead}</p>
        </div>

        {/* `.browse-tools` — the reference's right-hand cluster. */}
        <div className={styles.headerTools}>
          {actions}
          <ul className={styles.meta} aria-label="보드 상태">
            <li>
              <StatusPill tone="neutral">{total.toLocaleString("ko-KR")}개</StatusPill>
            </li>
            <li>
              {collected ? (
                <StatusPill tone="ready" ariaLabel="실제로 수집한 항목입니다">
                  수집됨
                </StatusPill>
              ) : (
                <StatusPill tone="warning" ariaLabel="예시 데이터입니다">
                  샘플 데이터
                </StatusPill>
              )}
            </li>
          </ul>
        </div>
      </div>

      {total > 0 && unenrichedNote !== undefined ? (
        <p className={cx(styles.notice, "type-body-small")} role="note">
          <Info
            className={styles.noticeIcon}
            strokeWidth={1.75}
            aria-hidden="true"
            focusable="false"
          />
          <span>{unenrichedNote}</span>
        </p>
      ) : null}
    </header>
  );
}
