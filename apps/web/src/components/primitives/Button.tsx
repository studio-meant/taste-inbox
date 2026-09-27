import type { LucideIcon } from "lucide-react";
import styles from "./Button.module.css";
import { cx } from "@/lib/cx";

/**
 * Button — DESIGN.md §9 "Primary action shape" and §11.14 DarkCapsuleAction.
 *
 * `primary` is the black capsule and is deliberately scarce: at most one per card, and
 * the document is explicit that not every button should be black. `secondary` and
 * `ghost` carry everything else.
 *
 * The component has no state of its own and no hooks, so it renders in both Server and
 * Client Components. Only the caller that needs `onClick` becomes a Client Component.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly compact?: boolean;
  readonly block?: boolean;
  /** Exactly one icon side is allowed (DESIGN.md §9). */
  readonly icon?: LucideIcon;
  readonly iconPosition?: "start" | "end";
  /**
   * Shows a spinner without changing the button's width. The label keeps its space so
   * the surrounding layout never reflows mid-action (DESIGN.md §11.14).
   */
  readonly loading?: boolean;
  /** Announced while `loading` is true. */
  readonly loadingLabel?: string;
}

export function Button({
  variant = "secondary",
  compact = false,
  block = false,
  icon: Icon,
  iconPosition = "start",
  loading = false,
  loadingLabel = "처리 중",
  children,
  className,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconNode =
    Icon === undefined ? null : (
      <Icon className={styles.icon} strokeWidth={1.75} aria-hidden="true" focusable="false" />
    );

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled ?? loading}
      // `aria-busy` is what tells assistive technology the action is in flight; the
      // spinner alone would be silent.
      aria-busy={loading || undefined}
      className={cx(
        styles.button,
        styles[variant],
        compact ? styles.compact : null,
        block ? styles.block : null,
        loading ? styles.loading : null,
        className,
      )}
    >
      <span className={styles.label}>
        {iconPosition === "start" ? iconNode : null}
        {children}
        {iconPosition === "end" ? iconNode : null}
      </span>
      {loading ? (
        <span className={styles.spinner}>
          <span className={styles.spinnerMark} />
          <span className="visually-hidden">{loadingLabel}</span>
        </span>
      ) : null}
    </button>
  );
}
