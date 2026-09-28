import type { SavedSummary } from "@taste-inbox/shared";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CardSurface } from "@/components/primitives";
import { kindLabel } from "@/components/collection/source-vocabulary";
import { SourceDots } from "./SourceDots";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";
import { toUrlObject } from "@/lib/filters/board-filters";

/**
 * New Saved Items — PAGE_SPECIFICATIONS §5.2, laid out as the reference's `SavedCard`
 * (ref.js:493):
 *
 *   New signals                                                              ›
 *   17  new items
 *   ▬▬▬▬▬▬▬▬▬▬▬  ▬▬▬▬▬▬
 *   [ Repo 120 ] [ Paper 9 ] [ Dataset 3 ]
 *   ( ● ● )                                                  Inbox에서 보기
 *
 * Count, split by kind, source summary, and a link to the day in the Inbox. The reference's
 * row of recent photographs went with Instagram: nothing collected now has a picture.
 *
 * It answers "얼마나 들어왔나" in one glance and nothing else; adding a second question here
 * would break DESIGN.md §11.11's one-question-per-card rule.
 *
 * The whole surface is the link, as in the reference — but a `<a>`, not the reference's
 * `<button>`, because it navigates. It is the card's only interactive element, so the
 * stretched hit area nests nothing.
 */

/**
 * `.saved-meter` — ref.css:254. The reference's three fixed fractions become the real
 * split, so the bar reports the data instead of decorating it. It is `aria-hidden`
 * because the tag row underneath already spells the same numbers out: the split must
 * never be carried by colour alone (CLAUDE.md §6).
 */
function SavedMeter({ segments }: { readonly segments: readonly number[] }) {
  const drawn = segments.filter((value) => value > 0);
  if (drawn.length === 0) {
    return null;
  }

  return (
    <div
      className={styles.savedMeter}
      style={{ gridTemplateColumns: drawn.map((value) => `${String(value)}fr`).join(" ") }}
      aria-hidden="true"
    >
      {drawn.map((value, index) => (
        <i key={`${String(index)}-${String(value)}`} className={styles.savedMeterSegment} />
      ))}
    </div>
  );
}

export function SavedItemsSummaryCard({ summary }: { readonly summary: SavedSummary }) {
  /*
   * The split of the number above it by kind — `Repo 120 · Paper 9 · Dataset 3` — the axis
   * the Inbox rail counts, so the card and the list it links to use one vocabulary. Every
   * chip is part of `newItemCount`; `기타` is whatever the split does not name, and
   * `Math.max` is only a floor for a payload whose parts do not add up.
   */
  const kinds = Object.entries(summary.kindCounts)
    .filter(([, count]) => count > 0)
    .map(([kind, count], index) => ({ key: kindLabel(kind), count, lead: index === 0 }));
  const otherCount = Math.max(
    0,
    summary.newItemCount - kinds.reduce((sum, kind) => sum + kind.count, 0),
  );

  return (
    <CardSurface
      as="section"
      tone="glass"
      radius="card"
      padding="none"
      className={cx(styles.overviewCard, styles.savedCard, styles.saved, styles.motionItem)}
      style={{ ["--i" as string]: "2" }}
      aria-labelledby="today-saved-heading"
    >
      <div className={styles.cardHeading}>
        {/*
          `New signals`, not `Saved Items` (2026-09-28).
          
          The figure under this heading has always been `newItemCount` — what arrived
          today — while the heading named the whole library, so the card read as
          "Saved Items 135" when 135 was the day's intake. Today's question is what came in
          and what to do about it (docs/next_step UI §2.2); the cumulative total is one
          click away in the Inbox, where the header states it.
        */}
        <h2 id="today-saved-heading" className={styles.cardHeadingTitle} lang="en">
          New signals
        </h2>
        <ChevronRight
          className={styles.cardHeadingIcon}
          strokeWidth={1.75}
          aria-hidden="true"
          focusable="false"
        />
      </div>

      {/* `.saved-count` — ref.css:252: the one figure that ports literally, at 44px. */}
      <p className={styles.savedCount}>
        <strong className={styles.savedCountValue}>
          {summary.newItemCount.toLocaleString("ko-KR")}
        </strong>
        <span className={styles.savedCountUnit}>오늘 들어옴</span>
      </p>

      <SavedMeter segments={[...kinds.map((kind) => kind.count), otherCount]} />

      {/* `.saved-tags` — ref.css:256. The reference's names carry no numbers; ours do,
          because that is the split the meter above is drawing. */}
      <div className={styles.tagRow}>
        {kinds.map((kind) => (
          <span
            key={kind.key}
            className={cx(styles.tag, kind.lead ? styles.tagGreen : null)}
          >{`${kind.key} ${kind.count.toLocaleString("ko-KR")}`}</span>
        ))}
        {otherCount > 0 ? (
          <span className={styles.tag}>{`기타 ${otherCount.toLocaleString("ko-KR")}`}</span>
        ) : null}
      </div>

      {/* `.saved-sources` — ref.css:262: the dot cluster left, the destination right. */}
      <div className={styles.savedFooter}>
        <SourceDots platforms={summary.sources} label="수집한 출처" />
        <Link
          href={toUrlObject(summary.href)}
          className={styles.savedLink}
          aria-label={`오늘 들어온 ${summary.newItemCount.toLocaleString("ko-KR")}개 항목을 Inbox에서 보기`}
        >
          Inbox에서 보기
        </Link>
      </div>
    </CardSurface>
  );
}
