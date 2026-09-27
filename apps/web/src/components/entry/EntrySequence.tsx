"use client";

import type { CeremonialEntry, TodayPayload } from "@taste-inbox/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./EntrySequence.module.css";
import { GreetingScreen } from "./GreetingScreen";
import { SplashScreen } from "./SplashScreen";
import { cx } from "@/lib/cx";

/**
 * The entry ceremony — Splash → Greeting → Today.
 *
 * The reference runs this as two co-mounted `.scene-layer`s inside one lab stage
 * (ref.js:530, ref.css:117-123): the outgoing screen keeps painting under the incoming one
 * for 820ms and then unmounts. That is reproduced here for Splash → Greeting, which is one
 * component's own state. Greeting → Today is a Next route change, not a state change, so it
 * gets the incoming route's own arrival stagger instead — recorded as a departure rather
 * than faked with a second co-mounted copy of Today.
 *
 * Client, because the whole file is interaction and motion (CLAUDE.md §6). Everything it
 * displays was fetched by the Server Component that renders it.
 */

export type CeremonyMode = Exclude<CeremonialEntry, "skip">;

export interface EntrySequenceProps {
  /** `full` opens on Splash; `brief` opens on Greeting. `skip` never reaches this file. */
  readonly mode: CeremonyMode;
  readonly today: TodayPayload;
  /** The workspace owner's name from onboarding; null greets without one. */
  readonly name?: string | null;
}

type Phase = "splash" | "greeting";

/**
 * IA §7.0: `duration 600–1000ms`, and never held past 1.2s even if first paint is late.
 *
 * The reference's Splash has no timer of its own — it waits for a click, and the 1500ms in
 * its `SCREENS` table drives the lab's autoplay reel, not the product. Waiting for a click
 * would mean a person who never clicks sits on a black screen indefinitely, so the
 * documented duration wins here: `docs/IA_WIREFRAMES.md` outranks `prototype/` in the
 * source-of-truth order (CLAUDE.md §3). Clicking, Enter and ⌘Enter all cut it short.
 */
const SPLASH_DURATION_MS = 900;

/**
 * 760ms of `sceneOutForward` plus the reference's own 60ms of slack (ref.js:554), after
 * which the outgoing layer stops existing rather than lingering at `opacity: 0`.
 */
const SCENE_UNMOUNT_MS = 820;

/**
 * Both reduced-motion triggers, read the way the rest of the app reads them.
 *
 * `data-motion` is stamped on `<html>` synchronously before hydration by
 * `components/theme/theme-bootstrap.ts`, so it is already correct on the first frame; the
 * media query is the OS preference underneath it, which the product switch can tighten but
 * never loosen.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (document.documentElement.dataset.motion === "reduced") {
    return true;
  }
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The reduced-motion decision has to happen before paint or a person who asked for less
 * motion sees a frame of the Splash they were promised they would not — IA §7.0: "reduced
 * motion에서는 fade 없이 즉시 Greeting 또는 Today로 이동한다". The plain hook would warn
 * during SSR, where it does nothing anyway.
 */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function EntrySequence({ mode, today, name = null }: EntrySequenceProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(mode === "full" ? "splash" : "greeting");
  const [previous, setPrevious] = useState<Phase | null>(null);
  const [reduced, setReduced] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /*
   * A ref, not the `leaving` state, because the guard has to hold within a single tick:
   * Enter and a click can land in the same frame, and a state read would still be `false`
   * for the second one. The state exists only to repaint the outgoing layer.
   */
  const leavingRef = useRef(false);
  const currentLayerRef = useRef<HTMLDivElement | null>(null);
  /*
   * Set only when the Splash is left while something inside it had focus.
   *
   * Swapping the screen destroys whatever the person was on, and the browser's answer to
   * that is to drop focus on `<body>` — silently, at the top of the document, on a screen
   * they never asked to leave. Moving focus onto the arriving screen is the fix, but only
   * for the person it happened to: doing it unconditionally would yank focus away from the
   * 900ms auto-advance for someone who had not touched the keyboard at all.
   */
  const restoreFocusRef = useRef(false);

  useBeforePaint(() => {
    if (!prefersReducedMotion()) {
      return;
    }
    setReduced(true);
    // Not "shorten the Splash" — remove it. There is nothing on it to read.
    setPhase((current) => (current === "splash" ? "greeting" : current));
  }, []);

  // The ceremony's only exit is a route change, so pay for it while the person is reading.
  useEffect(() => {
    router.prefetch("/today");
  }, [router]);

  const advance = useCallback(() => {
    if (phase === "splash") {
      const focused = document.activeElement;
      restoreFocusRef.current =
        focused !== null &&
        focused !== document.body &&
        currentLayerRef.current?.contains(focused) === true;
      setPhase("greeting");
      if (!reduced) {
        setPrevious("splash");
      }
      return;
    }
    if (leavingRef.current) {
      return;
    }
    leavingRef.current = true;
    setLeaving(true);
    router.push("/today");
  }, [phase, reduced, router]);

  useEffect(() => {
    if (phase !== "splash") {
      return;
    }
    const timer = window.setTimeout(advance, SPLASH_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [phase, advance]);

  useEffect(() => {
    if (!restoreFocusRef.current) {
      return;
    }
    restoreFocusRef.current = false;
    currentLayerRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (previous === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      setPrevious(null);
    }, SCENE_UNMOUNT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [previous]);

  /*
   * Enter and ⌘Enter, document-wide.
   *
   * IA §193 specifies `⌘ Enter` → Today and the Greeting prints those two caps, so they
   * have to work. The guards are what keep a global Enter handler from being a menace:
   * a text field keeps its own Enter, and a focused button or link keeps its native
   * activation — otherwise one keystroke would both click the button and advance again.
   * `⌘Enter` is not native activation for anything, so it passes through even there.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.defaultPrevented || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) {
          return;
        }
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          return;
        }
        if (!event.metaKey && !event.ctrlKey && (tag === "BUTTON" || tag === "A")) {
          return;
        }
      }
      event.preventDefault();
      advance();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [advance]);

  const layerFor = (which: Phase) =>
    which === "splash" ? (
      <SplashScreen onBegin={advance} />
    ) : (
      <GreetingScreen today={today} name={name} onBegin={advance} />
    );

  return (
    /*
     * The ceremonial container.
     *
     * `AppShell` cannot hold these two screens: its `main.content` applies `--content-max`,
     * the content padding and an 80px bottom reservation, and Greeting is four absolutely
     * positioned children of the frame. What is reproduced here is only the geometry that
     * makes the frame a frame — the mat, the inset, the two radii, and the three properties
     * `AppShell.module.css:87-89` calls out: `position` for the absolute layers, `isolation`
     * so the z-index tokens mean what they say, and `container-type` for the `cqw` unit the
     * whole reference is measured in.
     *
     * It is still the page's single `main` landmark, and still `#main`, so the root layout's
     * skip link lands somewhere on this route too.
     */
    <main id="main" className={styles.mat}>
      <div className={styles.frame}>
        {previous === null ? null : (
          <div
            key={`previous-${previous}`}
            className={cx(styles.layer, styles.previousLayer, styles.exit)}
            aria-hidden="true"
          >
            {layerFor(previous)}
          </div>
        )}
        <div
          key={`current-${phase}`}
          ref={currentLayerRef}
          className={cx(
            styles.layer,
            styles.currentLayer,
            previous === null ? null : styles.enter,
            leaving ? styles.exit : null,
          )}
          data-phase={phase}
          // Not in the tab order; a target for the focus move above, and nothing else.
          tabIndex={-1}
        >
          {layerFor(phase)}
        </div>
      </div>
    </main>
  );
}
