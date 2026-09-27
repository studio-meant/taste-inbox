"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_NAV_DESTINATIONS, isDestinationActive } from "@/lib/navigation/routes";
import styles from "./MobileBottomNav.module.css";
import { cx } from "@/lib/cx";

/**
 * Bottom navigation for mobile — IA §4.
 *
 * Carries all three global destinations, including System, which on desktop lives in
 * the right-hand status entry instead. A Client Component only because it reads the
 * current route.
 */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    // Shares its accessible name with GlobalNavPill on purpose: they are the same
    // navigation rendered at different breakpoints. Each is `display: none` outside its
    // own range, which removes it from the accessibility tree, so a user never meets
    // two navigation landmarks with the same name.
    <nav className={styles.nav} aria-label="주요 화면">
      {BOTTOM_NAV_DESTINATIONS.map((destination) => {
        const active = isDestinationActive(destination, pathname);
        const Icon = destination.icon;

        return (
          <Link
            key={destination.id}
            href={destination.href}
            className={cx(styles.item, "hit-44")}
            aria-current={active ? "page" : undefined}
          >
            <Icon className={styles.icon} strokeWidth={1.75} aria-hidden="true" focusable="false" />
            <span lang={destination.labelLang}>{destination.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
