"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PILL_DESTINATIONS,
  findActiveDestination,
  isDestinationActive,
  type DestinationId,
} from "@/lib/navigation/routes";
import styles from "./GlobalNavPill.module.css";
import { GridGlyph, HomeGlyph, type ReferenceIconProps } from "./ReferenceIcons";
import { cx } from "@/lib/cx";

/**
 * The centre pill — Today and Browse only (IA §4).
 *
 * A Client Component for exactly one reason: it reads the current route to mark the
 * active destination. Nothing else here is interactive; the items are ordinary links,
 * so the keyboard and browser history behave natively.
 *
 * The reference draws this as a physical two-position switch: an ink-tinted track with a
 * pale slider that slides across in 520ms. The slider is `aria-hidden` decoration —
 * `aria-current="page"`, the colour change *and* the weight change all still carry the
 * state, so it is never expressed by the moving part alone (DESIGN.md §18).
 */

/**
 * The reference's own glyphs rather than the lucide icons in `routes.ts`, which are
 * still what the mobile bar and the command palette use. Falls back to the destination's
 * own icon if the model ever grows a pill entry this map has not met.
 */
const PILL_GLYPHS: Partial<Record<DestinationId, (props: ReferenceIconProps) => React.ReactNode>> =
  {
    today: HomeGlyph,
    browse: GridGlyph,
  };

export function GlobalNavPill() {
  const pathname = usePathname();
  const activeId = findActiveDestination(pathname)?.id;
  // `none` rather than an absent attribute, so the CSS has a state to park the slider in
  // on a route outside the model (Settings, an error boundary) instead of lying.
  const switchState: DestinationId | "none" =
    activeId === "today" || activeId === "browse" ? activeId : "none";

  return (
    <nav className={styles.pill} aria-label="주요 화면" data-active={switchState}>
      <span className={styles.slider} aria-hidden="true" />
      {PILL_DESTINATIONS.map((destination) => {
        const active = isDestinationActive(destination, pathname);
        const Glyph = PILL_GLYPHS[destination.id];
        const FallbackIcon = destination.icon;

        return (
          <Link
            key={destination.id}
            href={destination.href}
            className={cx(styles.item, "hit-44")}
            aria-current={active ? "page" : undefined}
          >
            {Glyph === undefined ? (
              <FallbackIcon
                className={styles.icon}
                strokeWidth={1.8}
                aria-hidden="true"
                focusable="false"
              />
            ) : (
              <Glyph className={styles.icon} />
            )}
            <span lang={destination.labelLang}>{destination.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
