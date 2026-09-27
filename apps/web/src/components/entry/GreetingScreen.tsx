import type { TodayPayload } from "@taste-inbox/shared";
import Link from "next/link";
import { StatusPill } from "@/components/primitives/StatusPill";
import { AmbientCanvas } from "@/components/shell/AmbientCanvas";
import { BrandMark } from "./BrandMark";
import {
  entryStatusPills,
  entrySubline,
  formatEntryDate,
  greetingHeadline,
  PRODUCT_NAME,
} from "./copy";
import styles from "./GreetingScreen.module.css";
import { cx } from "@/lib/cx";

/**
 * Greeting — `Greeting()` at ref.js:486, `.greeting-*` at ref.css:178-198.
 *
 * This is the one screen the reference renders the scenic world at full strength:
 * Today, Browse and Focus all call `h(Scenic,{quiet:true})`, Greeting alone calls
 * `h(Scenic,{greeting:true})`. `AmbientCanvas` has had both halves of that since it was
 * written — `intensity="scenic"` skips `.quiet` and `animated` opens the 12s glow drift
 * its own comment reserves for "the ceremonial Greeting" — and until now nothing called
 * either. This is the first caller.
 *
 * Three departures from the reference, each with its reason at the point it happens:
 * the `⌘ Enter` caps are live rather than decorative, the bottom-left cue points at Today
 * instead of an Activity Timeline that does not exist, and the status cluster carries two
 * pills instead of three.
 */
export interface GreetingScreenProps {
  /** The workspace owner's name from onboarding. */
  readonly name?: string | null;
  readonly today: TodayPayload;
  /** Advance to Today. */
  readonly onBegin: () => void;
}

export function GreetingScreen({ today, name = null, onBegin }: GreetingScreenProps) {
  const pills = entryStatusPills(today.counts);

  return (
    <section className={styles.greeting} aria-labelledby="entry-greeting-title">
      {/*
       * Wrapped rather than styled directly: `.greeting-scenic .scenic-art` (ref.css:144)
       * is one rule that lives nowhere in `AmbientCanvas.module.css`, and that file is not
       * this change's to edit. The wrapper reaches the same `<svg>` through the element
       * selector instead of through a class name it cannot see.
       */}
      <div className={styles.scenic}>
        <AmbientCanvas intensity="scenic" animated />
      </div>

      <div className={cx(styles.brand, styles.motionItem)} style={{ ["--i" as string]: "0" }}>
        <BrandMark compact />
        <span lang="en">{PRODUCT_NAME}</span>
      </div>

      <div className={styles.center}>
        <p className={cx(styles.eyebrow, styles.motionItem)} style={{ ["--i" as string]: "1" }}>
          <time dateTime={today.date}>{formatEntryDate(today.date)}</time>
        </p>

        <h1
          id="entry-greeting-title"
          className={cx(styles.headline, styles.motionItem)}
          style={{ ["--i" as string]: "2" }}
        >
          {greetingHeadline(today.greeting, name)}
        </h1>

        <p className={cx(styles.subline, styles.motionItem)} style={{ ["--i" as string]: "3" }}>
          {entrySubline(today.counts.newItems)}
        </p>

        <div className={cx(styles.keyRow, styles.motionItem)} style={{ ["--i" as string]: "4" }}>
          {/*
           * Live, not painted on. In the reference these caps are decoration —
           * `App.prototype.keydown` (ref.js:559) handles digits, arrows, Space and three
           * letters, and neither `metaKey` nor `Enter` among them. IA §193 specifies
           * `⌘ Enter` → Today, so `EntrySequence` binds it; printing a shortcut that does
           * nothing would be the screen's only lie.
           */}
          <kbd className={styles.key} lang="en">
            ⌘
          </kbd>
          <kbd className={styles.key} lang="en">
            Enter
          </kbd>
          <button
            type="button"
            className={styles.begin}
            onClick={onBegin}
            aria-keyshortcuts="Meta+Enter"
          >
            눌러서 시작하기
          </button>
        </div>
      </div>

      {/*
       * The reference puts `Activity Timeline ↓` here. There is no activity timeline in
       * this product — the string appears once in IA §7.1 and nowhere in the app — and a
       * cue pointing at a screen that does not exist is an affordance for a feature that
       * does not exist. The corner keeps its job (say where you can go from here) with the
       * one destination that is real, which is also what keeps the ceremony escapable
       * without waiting for it.
       */}
      <div className={cx(styles.cue, styles.motionItem)} style={{ ["--i" as string]: "5" }}>
        {/*
         * `Today` is a product noun and carries `lang="en"` wherever it stands alone
         * (`TodayHeader.tsx:65`). Here it is inside a Korean sentence, and wrapping it
         * mid-phrase makes the accessible-name algorithm read "Today 로 바로 가기" — a
         * space between a noun and its particle, which is not how the sentence is said.
         * The document is `lang="ko"`; one text node keeps the name and the copy identical.
         */}
        <Link className={styles.cueLink} href="/today">
          <span>Today로 바로 가기</span>
          <span className={styles.cueArrow} aria-hidden="true">
            →
          </span>
        </Link>
      </div>

      <div className={cx(styles.status, styles.motionItem)} style={{ ["--i" as string]: "6" }}>
        {pills.map((pill) => (
          <StatusPill key={pill.key} tone={pill.tone} onScenic>
            {pill.label}
          </StatusPill>
        ))}
      </div>
    </section>
  );
}
