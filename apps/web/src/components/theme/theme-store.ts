import {
  DEFAULT_THEME_ID,
  THEME_IDS,
  THEME_STORAGE_KEY,
  resolveTheme,
} from "@taste-inbox/ui/theme";

/**
 * The one place that writes the applied theme.
 *
 * Applying a theme is a single attribute swap on `<html>` plus a single storage write —
 * deliberately not a navigation, a router refresh or a server round trip, because
 * CLAUDE.md §6 requires the current screen, its filters and the Query Dock to survive a
 * theme change. Every colour in the product is a custom property emitted by
 * `ThemeStyles` under a `[data-theme]` block, so swapping the attribute repaints
 * everything in place and the URL is never touched.
 *
 * The stamped attribute — not the storage entry — is the source of truth for "what am I
 * looking at". `theme-bootstrap.ts` stamps it before first paint from storage, falling
 * back to the default for an unknown value, so reading the DOM back gives the resolved
 * answer instead of re-implementing that fallback here.
 *
 * No React in this module: it is the store behind `useSyncExternalStore`, and keeping it
 * plain means the bootstrap's contract can be tested without rendering anything.
 */

const listeners = new Set<() => void>();

function isKnownThemeId(id: string | null | undefined): id is string {
  return typeof id === "string" && THEME_IDS.includes(id);
}

/**
 * The snapshot React hydrates with.
 *
 * The server cannot know the stored choice — it lives in this browser only — so the
 * server render says "default" and `useSyncExternalStore` re-reads the real value right
 * after hydration. That is a one-frame correction of a *name in the summary*, never of
 * the painted colours: the inline bootstrap has already stamped the right theme on
 * `<html>` before first paint.
 */
export const SERVER_THEME_ID: string = DEFAULT_THEME_ID;

/** The id stamped on `<html>`, i.e. the theme the user is actually looking at. */
export function readAppliedThemeId(): string {
  const stamped = document.documentElement.dataset.theme;
  return isKnownThemeId(stamped) ? stamped : DEFAULT_THEME_ID;
}

/**
 * Apply a theme and remember it.
 *
 * `resolveTheme` rather than a bare assignment, so an id that is not in the registry
 * falls back to the product default instead of stamping an attribute no stylesheet
 * matches, which would leave the app with no colours at all.
 */
export function applyTheme(id: string): void {
  const theme = resolveTheme(id);
  document.documentElement.dataset.theme = theme.id;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // A blocked or full store must not stop the theme from being applied to this
    // session — the same rule the bootstrap follows in the other direction.
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Subscribe to theme changes, including ones made in another tab.
 *
 * Single-user product, but a second tab of the same workspace is ordinary, and a `storage`
 * event is the only signal that the choice moved out from under this document. The
 * attribute is re-stamped there too, so the other tab repaints instead of only relabelling.
 */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);

  function onStorage(event: StorageEvent): void {
    if (event.key !== THEME_STORAGE_KEY) {
      return;
    }
    if (isKnownThemeId(event.newValue)) {
      document.documentElement.dataset.theme = event.newValue;
    }
    listener();
  }

  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
