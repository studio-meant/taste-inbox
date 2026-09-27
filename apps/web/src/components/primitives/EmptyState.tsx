import type { LucideIcon } from "lucide-react";
import styles from "./States.module.css";
import { cx } from "@/lib/cx";

/**
 * EmptyState — DESIGN.md §15.
 *
 * "데이터가 적은 날은 카드를 무리하게 늘리지 않고 문장과 여백으로 상태를 설명한다."
 * So an empty state is a sentence explaining *why* it is empty, not a placeholder
 * pretending content is missing. `title` is required; `description` should say what
 * would make content appear.
 */
export interface EmptyStateProps {
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly icon?: LucideIcon;
  readonly action?: React.ReactNode;
  readonly centered?: boolean;
  /** Heading level, so the state slots into the page's outline correctly. */
  readonly as?: "h2" | "h3" | "p";
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  centered = false,
  as: Heading = "p",
}: EmptyStateProps) {
  return (
    <div className={cx(styles.state, centered ? styles.centered : null)}>
      {Icon === undefined ? null : (
        <Icon className={styles.icon} strokeWidth={1.6} aria-hidden="true" focusable="false" />
      )}
      <Heading className={cx(styles.title, "type-card-title")}>{title}</Heading>
      {description === undefined ? null : (
        <p className={cx(styles.body, "type-body")}>{description}</p>
      )}
      {action === undefined ? null : <div className={styles.actions}>{action}</div>}
    </div>
  );
}
