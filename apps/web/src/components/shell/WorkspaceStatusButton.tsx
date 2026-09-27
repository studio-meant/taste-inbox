import { CircleX, Settings, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import styles from "./WorkspaceStatusButton.module.css";
import { cx } from "@/lib/cx";

/**
 * System attention entry — IA §4, DESIGN.md §11.3.
 *
 * "attention이 있으면 status indicator에 작은 semantic dot과 count를 표시한다."
 *
 * The reference's right-hand control is a circle, not a text pill, so the status word
 * moves out of the visual box. Three signals replace it, none of them colour:
 *
 *   1. a different glyph per state — check / warning triangle / cross
 *   2. the Korean status word, verbatim, in `aria-label`
 *   3. the count badge, when there is one; a digit is not a hue
 *
 * A user who cannot distinguish the dot colours reads exactly the same information
 * (DESIGN.md §18).
 */
export type WorkspaceStatus = "healthy" | "attention" | "failed";

const STATUS_LABEL: Readonly<Record<WorkspaceStatus, string>> = {
  healthy: "정상",
  attention: "확인 필요",
  failed: "실패",
};

/*
 * The glyph says the destination when there is nothing wrong, and the problem when there is.
 *
 * `healthy` used to be a check mark, which spent the product's most persistent control
 * restating a thing the absence of a badge already says. The button's actual job in that
 * state is "this is the way to System", and a gear says so; the two states that carry real
 * news keep the glyphs that carry it.
 *
 * The non-colour rule (DESIGN.md §18) is unaffected: the three states are still three
 * different shapes, and the Korean status word is still in the accessible name.
 */
const STATUS_ICON: Readonly<Record<WorkspaceStatus, LucideIcon>> = {
  healthy: Settings,
  attention: TriangleAlert,
  failed: CircleX,
};

export interface WorkspaceStatusButtonProps {
  readonly status: WorkspaceStatus;
  /** Number of items needing attention. Omitted when the system is healthy. */
  readonly count?: number;
}

export function WorkspaceStatusButton({ status, count }: WorkspaceStatusButtonProps) {
  const label = STATUS_LABEL[status];
  const Glyph = STATUS_ICON[status];
  const showCount = status !== "healthy" && count !== undefined && count > 0;

  return (
    <Link
      href="/system"
      data-status={status}
      className={cx(styles.button, styles[status], "hit-44")}
      aria-label={
        showCount ? `시스템 상태 ${label} ${String(count)}건, 열기` : `시스템 상태 ${label}, 열기`
      }
    >
      <Glyph className={styles.glyph} strokeWidth={1.8} aria-hidden="true" focusable="false" />
      {showCount ? (
        <span className={styles.dot} aria-hidden="true">
          {count.toLocaleString("ko-KR")}
        </span>
      ) : null}
    </Link>
  );
}
