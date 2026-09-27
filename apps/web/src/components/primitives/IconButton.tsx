import type { LucideIcon } from "lucide-react";
import styles from "./IconButton.module.css";
import { cx } from "@/lib/cx";

/**
 * Icon-only control.
 *
 * `label` is required rather than optional: an icon-only button with no accessible
 * name is the single most common accessibility defect in a dashboard, and the type
 * system is the cheapest place to prevent it (frontend architecture §23).
 */
export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  readonly icon: LucideIcon;
  /** Accessible name. Also used as the tooltip when the host provides one. */
  readonly label: string;
  readonly outlined?: boolean;
  readonly large?: boolean;
}

export function IconButton({
  icon: Icon,
  label,
  outlined = false,
  large = false,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      className={cx(
        styles.iconButton,
        "hit-44",
        outlined ? styles.outlined : null,
        large ? styles.large : null,
        className,
      )}
    >
      <Icon className={styles.icon} strokeWidth={1.75} aria-hidden="true" focusable="false" />
    </button>
  );
}
