import { BrandMark } from "./BrandMark";
import { PRODUCT_NAME } from "./copy";
import styles from "./SplashScreen.module.css";

/**
 * Splash — `Splash()` at ref.js:484, `.splash-*` at ref.css:162-176.
 *
 * Structure is the reference's: a graphite ground, a noise wash, the mark and wordmark on
 * one flex row with the tagline absolutely positioned flush to the wordmark's left edge,
 * and a pulsing hint at the bottom.
 *
 * **The one thing that is not the reference's is how you leave.** There, the whole screen
 * is a bare `<section onClick>`: not focusable, no role, no keyboard path — a dead end for
 * anyone not using a mouse, on the app's front door. Here the hit area is a real
 * `<button>` filling the frame, so it is in the tab order, activates on Enter and Space,
 * and draws a focus ring. Its accessible name is the visible hint, so what is announced
 * and what is printed are the same sentence.
 */
export interface SplashScreenProps {
  /** Advance to Greeting. */
  readonly onBegin: () => void;
}

export function SplashScreen({ onBegin }: SplashScreenProps) {
  return (
    <section className={styles.splash} aria-labelledby="entry-splash-title">
      <div className={styles.noise} aria-hidden="true" />

      <div className={styles.center}>
        <span className={styles.markWrap}>
          <BrandMark className={styles.mark} />
          <span className={styles.aura} aria-hidden="true" />
        </span>
        <h1 id="entry-splash-title" className={styles.wordmark} lang="en">
          {PRODUCT_NAME}
        </h1>
        {/*
         * The reference reads `LOCAL TASTE INTELLIGENCE`. "Intelligence" is a claim about
         * enrichment, and no enricher has run in this build — `readyActions` is a hardcoded
         * zero for exactly that reason. `WORKSPACE` is the product's own word for itself
         * (CLAUDE.md §1: "개인용 로컬 워크스페이스") and is true today.
         */}
        <p className={styles.tagline} lang="en">
          LOCAL TASTE WORKSPACE
        </p>
      </div>

      <button type="button" className={styles.hit} onClick={onBegin}>
        <span className={styles.hint}>아무 곳이나 눌러 시작하세요</span>
      </button>
    </section>
  );
}
