import type { Theme } from "@taste-inbox/ui/theme";
import { cx } from "@/lib/cx";
import styles from "./ThemeCardPreview.module.css";

/**
 * The picture on a theme card — the reference's `MiniPreview` and `Swatches`.
 *
 * Both are decorative by design: a miniature of the shell in the previewed theme, and the
 * six colours that theme is built from. Neither carries information the card does not also
 * say in words (name, group, description, note), so both are hidden from assistive
 * technology instead of being narrated as a list of hexes (DESIGN.md §18 — meaning is never
 * colour alone, and the fix is words, not a colour read aloud).
 *
 * No `"use client"`: presentational, no state. It renders in the client bundle only
 * because `ThemePicker` imports it.
 */

/** The seven tokens the reference's preview samples, under its own `--p-*` names. */
function previewVariables(theme: Theme): React.CSSProperties {
  return {
    "--p-shell": theme.tokens.shell,
    "--p-surface": theme.tokens.surface,
    "--p-accent": theme.tokens.accent,
    "--p-leaf": theme.tokens.hill2,
    "--p-oat": theme.tokens.outerDeep,
    "--p-wood": theme.tokens.wood,
    "--p-ink": theme.tokens.ink,
  } as React.CSSProperties;
}

export function ThemeMiniPreview({ theme }: { readonly theme: Theme }) {
  return (
    <span className={styles.preview} style={previewVariables(theme)} aria-hidden="true">
      <i className={styles.previewBg} />
      <i className={cx(styles.previewCard, styles.previewCardOne)} />
      <i className={cx(styles.previewCard, styles.previewCardTwo)} />
      <i className={cx(styles.previewCard, styles.previewCardThree)} />
      <i className={styles.previewDock} />
    </span>
  );
}

export function ThemeSwatches({ colors }: { readonly colors: readonly string[] }) {
  return (
    <span className={styles.swatches} aria-hidden="true">
      {colors.map((color, index) => (
        <i key={`${color}-${String(index)}`} style={{ background: color }} />
      ))}
    </span>
  );
}
