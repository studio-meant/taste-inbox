import type { StatusTone } from "@taste-inbox/ui/theme";
import { AlertTriangle, Check, CircleAlert, Info, Minus, type LucideIcon } from "lucide-react";
import styles from "./StatusPill.module.css";
import { cx } from "@/lib/cx";

/**
 * Compact semantic state indicator — DESIGN.md §11.15.
 *
 * Two rules shape the API:
 *
 * - **Never colour-only.** An icon is always rendered alongside the label
 *   (DESIGN.md §18, frontend architecture §23). The icon is not decorative; it is the
 *   second channel, so it is not `aria-hidden` unless the label already says the same
 *   thing — which it always does here, hence the hidden icon plus visible text.
 * - **No domain vocabulary.** The primitive knows `ready | info | warning | danger |
 *   neutral`, never `ready_local` or `auth_required` (frontend architecture §6.1).
 *   Mapping lives in the domain layer.
 */

const TONE_ICON: Readonly<Record<StatusTone, LucideIcon>> = {
  ready: Check,
  info: Info,
  warning: AlertTriangle,
  danger: CircleAlert,
  neutral: Minus,
};

export interface StatusPillProps {
  readonly tone: StatusTone;
  /** Short and concrete: "Ready · Local", "토큰 필요", "정확히 일치". */
  readonly children: React.ReactNode;
  /** Replace the tone's default icon when a more specific one reads better. */
  readonly icon?: LucideIcon;
  /** Allow the label to wrap. Use for long Korean status text in narrow columns. */
  readonly wrap?: boolean;
  /** Adds a legible ground when the pill sits directly on the scenic backdrop. */
  readonly onScenic?: boolean;
  /**
   * Announced instead of the visible label when the label is an abbreviation. Supplying it
   * makes the pill an `img` node, so the visible text stops being announced on its own —
   * which is the point: `Exact match` read aloud in a Korean screen reader is not a status.
   */
  readonly ariaLabel?: string;
}

export function StatusPill({
  tone,
  children,
  icon,
  wrap = false,
  onScenic = false,
  ariaLabel,
}: StatusPillProps) {
  const Icon = icon ?? TONE_ICON[tone];

  return (
    <span
      className={cx(
        styles.pill,
        styles[tone],
        wrap ? styles.wrap : null,
        onScenic ? styles.onScenic : null,
      )}
      /*
       * `aria-label` is prohibited on a role-less <span> and browsers do not expose it, so
       * the Korean name DomainStatusPill supplies was never reaching a screen reader — the
       * English pill text was read instead. `role="img"` is the repo's existing answer
       * (CollectedImage's fallback), and unlike a visually-hidden span it works: role=generic
       * has no name-from-content, so that route measures as "".
       *
       * Only when a name was given. An unnamed role="img" would be worse than no role.
       */
      role={ariaLabel === undefined ? undefined : "img"}
      aria-label={ariaLabel}
    >
      <Icon
        className={styles.icon}
        strokeWidth={1.75}
        // The visible label already carries the meaning, so the icon is decorative
        // to a screen reader while remaining the visual second channel.
        aria-hidden="true"
        focusable="false"
      />
      {children}
    </span>
  );
}
