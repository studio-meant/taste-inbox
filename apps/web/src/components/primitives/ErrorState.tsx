import { TriangleAlert } from "lucide-react";
import styles from "./States.module.css";
import { cx } from "@/lib/cx";

/**
 * ErrorState — DESIGN.md §15 and frontend architecture §24.
 *
 * Copy is driven by an error *code*, never by a raw backend message
 * (architecture §18 "Rules"): a message from the service can leak a path, a token name,
 * or English internals into a Korean-first UI. `detail` exists for the operator and is
 * collapsed by default.
 */
export interface ErrorStateProps {
  readonly title: string;
  readonly description?: React.ReactNode;
  /** Technical detail, shown only on demand. Never include a secret value. */
  readonly detail?: string;
  readonly detailLabel?: string;
  readonly action?: React.ReactNode;
  readonly centered?: boolean;
  readonly as?: "h1" | "h2" | "h3" | "p";
  /**
   * Announce the failure to assistive technology.
   *
   * Default `false`: an error boundary that replaces a page is already announced by
   * the normal page-change mechanism, and DESIGN.md §18 restricts `aria-live` to cases
   * that genuinely need it — build status and collector failure. Set `true` only when
   * the error appears inside a view the user is already reading.
   */
  readonly live?: boolean;
}

export function ErrorState({
  title,
  description,
  detail,
  detailLabel = "기술 정보 보기",
  action,
  centered = false,
  as: Heading = "p",
  live = false,
}: ErrorStateProps) {
  return (
    <div
      className={cx(styles.state, centered ? styles.centered : null)}
      // `role="status"` rather than `role="alert"`: alert implies assertive, which
      // interrupts whatever the user is reading. Nothing in the documents describes a
      // failure urgent enough to warrant an interrupt.
      role={live ? "status" : undefined}
    >
      <TriangleAlert
        className={cx(styles.icon, styles.errorIcon)}
        strokeWidth={1.6}
        aria-hidden="true"
        focusable="false"
      />
      <Heading className={cx(styles.title, "type-card-title")}>{title}</Heading>
      {description === undefined ? null : (
        <p className={cx(styles.body, "type-body")}>{description}</p>
      )}
      {action === undefined ? null : <div className={styles.actions}>{action}</div>}
      {detail === undefined ? null : (
        <details className={cx(styles.detail, "type-body-small")}>
          <summary>{detailLabel}</summary>
          <pre className={cx(styles.detailBody, "type-mono")}>{detail}</pre>
        </details>
      )}
    </div>
  );
}
