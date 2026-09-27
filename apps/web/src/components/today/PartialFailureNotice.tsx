import type { SourceStatusSummary } from "@taste-inbox/shared";
import { Info } from "lucide-react";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";

/**
 * Partial failure — PAGE_SPECIFICATIONS §5.2 and §2.7.
 *
 * The documented sentence names what succeeded *before* what failed:
 *
 *   "Instagram Saved는 정상 수집했지만 LinkedIn Reactions는 로그인 만료로 건너뛰었어요."
 *
 * That ordering matters. A page that leads with the failure makes a partly-successful
 * collection read as a broken one.
 */

const FAILURE_REASON: Readonly<Record<string, string>> = {
  auth_required: "로그인 만료로",
  failed: "오류로",
  skipped: "이번 차례를 건너뛰어",
};

export function PartialFailureNotice({ summary }: { readonly summary: SourceStatusSummary }) {
  const collected = summary.sources.filter((source) => source.state === "collected");
  const interrupted = summary.sources.filter(
    (source) => source.state === "auth_required" || source.state === "failed",
  );

  if (interrupted.length === 0) {
    return null;
  }

  const collectedNames = collected.map((source) => source.label).join(", ");
  const interruptedText = interrupted
    .map((source) => `${source.label}는 ${FAILURE_REASON[source.state] ?? "알 수 없는 이유로"}`)
    .join(", ");

  return (
    <p className={cx(styles.notice, "type-body-small")}>
      <Info className={styles.noticeIcon} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      <span>
        {collected.length > 0 ? `${collectedNames}는 정상 수집했지만 ` : ""}
        {interruptedText} 건너뛰었어요.
      </span>
    </p>
  );
}
