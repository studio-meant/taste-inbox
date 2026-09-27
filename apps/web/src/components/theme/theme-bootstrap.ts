import { DEFAULT_THEME_ID, THEME_IDS, THEME_STORAGE_KEY } from "@taste-inbox/ui/theme";

/**
 * Inline bootstrap that restores the saved appearance before first paint.
 *
 * Only appearance preference lives in local storage — never anything sensitive
 * (frontend architecture §3 "Persistence"). An unknown or corrupted value falls back to
 * the product default rather than throwing, because a bad storage entry must not stop
 * the app from rendering.
 */
export const MOTION_STORAGE_KEY = "taste-inbox-motion-v1";

/**
 * Motion modes.
 *
 * - `cinematic` — the product default. Scene transitions and component motion, but no
 *   continuous ambient loop (DESIGN.md §14 "Principles").
 * - `ambient` — cinematic plus the continuous loops specified in
 *   COMPONENT_MOTION_SPEC.md §3 and MOTION_SPEC.json. Kept as a switchable mode so the
 *   two readings of the motion documents can be compared side by side rather than
 *   argued about.
 * - `reduced` — opacity only, no loops.
 *
 * The OS `prefers-reduced-motion` setting is a floor: it can tighten any of these but
 * none of them can loosen it.
 */
export type MotionMode = "cinematic" | "ambient" | "reduced";

export const DEFAULT_MOTION_MODE: MotionMode = "cinematic";

export function buildThemeBootstrapScript(): string {
  const knownThemes = JSON.stringify(THEME_IDS);
  const knownMotion = JSON.stringify(["cinematic", "ambient", "reduced"] satisfies MotionMode[]);

  // Written as a compact IIFE because it runs synchronously before hydration.
  return `(function(){try{
var r=document.documentElement;
var themes=${knownThemes};
var motions=${knownMotion};
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
r.dataset.theme=themes.indexOf(t)>-1?t:${JSON.stringify(DEFAULT_THEME_ID)};
var m=localStorage.getItem(${JSON.stringify(MOTION_STORAGE_KEY)});
r.dataset.motion=motions.indexOf(m)>-1?m:${JSON.stringify(DEFAULT_MOTION_MODE)};
}catch(e){}})();`;
}
