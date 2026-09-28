import { WorkspaceQueryDock } from "@/components/query";
import { AmbientCanvas, type AmbientIntensity } from "./AmbientCanvas";
import styles from "./AppShell.module.css";
import { cx } from "@/lib/cx";
import { isRemoteReadOnly } from "@/lib/remote-mode";

/**
 * The framed scenic workspace — DESIGN.md §11.1, frontend architecture §7.1.
 *
 * Composition, not decoration: it owns the outer mat, the inset rounded screen, and the
 * scroll container. Everything inside is passed in, so the shell has no opinion about
 * which screen it is holding.
 *
 * The scenic backdrop is the frame's *first child*, not a sibling of the shell: it is
 * the screen's own wallpaper and is clipped by the same rounded corner as the content.
 * That is also what lets the chrome measure itself in `cqw` against the frame
 * (`container-type: inline-size`), which is how the reference is specified.
 *
 * Server Component. The shell itself never needs client JavaScript; only the navigation
 * and the query dock inside it do.
 */
export interface AppShellProps {
  readonly children: React.ReactNode;
  /** Rendered above the viewport, inside the frame. */
  readonly contextBar?: React.ReactNode;
  /** Rendered outside the frame, below it, on mobile only. */
  readonly bottomNav?: React.ReactNode;
  /**
   * Floating dock, rendered inside the frame.
   *
   * Defaults to the Taste Query Dock, which mounts itself on workspace routes only —
   * System and Settings are not places to ask questions of the library. Pass an explicit
   * node to override, or `null` to render none.
   */
  readonly dock?: React.ReactNode;
  /**
   * Centre one thing in the frame instead of scrolling a column.
   *
   * The content column is built for boards: a small top padding and a large bottom
   * clearance for what used to float over it. Those are right for a screen you scroll and
   * wrong for a screen that is a single card — centring inside them puts the card above
   * the middle by half the difference, which is what the first-run screen did.
   */
  readonly fill?: boolean;
  readonly ambient?: AmbientIntensity;
}

export function AppShell({
  children,
  contextBar,
  bottomNav,
  dock,
  fill = false,
  ambient = "tonal",
}: AppShellProps) {
  return (
    <div className={cx(styles.shell, bottomNav === undefined ? null : styles.withBottomNav)}>
      <div className={styles.frame}>
        <AmbientCanvas intensity={ambient} />
        {contextBar}
        {isRemoteReadOnly() ? (
          <p className={styles.remoteNotice} role="note">
            원격 읽기 전용 · 수집은 맥미니에서 계속 진행돼요. 변경은 맥미니 앱에서 해주세요.
          </p>
        ) : null}
        {/* The single `main` landmark for the workspace (architecture §23). */}
        <div className={styles.viewport}>
          <main id="main" className={cx(styles.content, fill ? styles.contentFill : null)}>
            {children}
          </main>
        </div>
        {dock === undefined ? <WorkspaceQueryDock /> : dock}
      </div>
      {bottomNav}
    </div>
  );
}
