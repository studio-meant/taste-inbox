import type { SavedSummary } from "@taste-inbox/shared";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CardSurface } from "@/components/primitives";
import { SourceDots } from "./SourceDots";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";
import { toUrlObject } from "@/lib/filters/board-filters";

/**
 * New Saved Items — PAGE_SPECIFICATIONS §5.2, laid out as the reference's `SavedCard`
 * (ref.js:493):
 *
 *   Saved Items                                                              ›
 *   17  new items
 *   ▬▬▬▬▬▬▬▬▬▬▬  ▬▬▬▬▬▬
 *   [ AI 11 ] [ Style 6 ]
 *   [ latest ] [ latest ] [ latest ]
 *   ( ● ● ● ● )                                                     모두 보기
 *
 * Count, split, source summary, up to three recent previews, and a link to the
 * collection. It answers "얼마나 들어왔나" in one glance and nothing else; adding a
 * second question here would break DESIGN.md §11.11's one-question-per-card rule.
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
   * The split of the number above it, board by board.
   *
   * Every chip here is part of `newItemCount`, and together with `기타` they add to it —
   * the reference states the same contract in its own figures (`17 new items · AI 11 ·
   * Style 6`). Music and Places are named rather than folded into the remainder: this
   * product has four boards where the reference drew two, and a saved Reel appearing only
   * as an anonymous meter segment was the cost of porting the shape instead of the rule.
   * Places is listed while it is still always zero — `shown` drops it, so an empty board
   * costs no chip, and the day it receives something the chip appears with no change here.
   *
   * `Math.max` stays, and is now only ever a floor for rounding rather than a lid on a
   * contradiction. It used to clamp `10 - 41 - 76` to zero, which is how a card headed
   * with today's ten came to show two all-time board totals underneath and look fine.
   */
  const boards = [
    { key: "AI", count: summary.aiCount, lead: true },
    { key: "Style", count: summary.styleCount, lead: false },
    { key: "Music", count: summary.musicCount, lead: false },
    { key: "Places", count: summary.placesCount, lead: false },
  ] as const;
  const otherCount = Math.max(
    0,
    summary.newItemCount - boards.reduce((sum, board) => sum + board.count, 0),
  );
  // Only the boards that actually received something. A row of zeroes says nothing the
  // headline has not already said, and on a quiet day it would be three of them.
  const shown = boards.filter((board) => board.count > 0);
  // `preview` keeps an already-running desktop bundle compatible during deployment. The
  // new payload always sends `previews`; the fallback only matters across that short seam.
  const previews =
    summary.previews.length > 0
      ? summary.previews
      : summary.preview === null
        ? []
        : [summary.preview];

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
        <h2 id="today-saved-heading" className={styles.cardHeadingTitle} lang="en">
          Saved Items
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
        <span className={styles.savedCountUnit}>새 항목</span>
      </p>

      <SavedMeter segments={[...boards.map((board) => board.count), otherCount]} />

      {/* `.saved-tags` — ref.css:256. The reference's board names carry no numbers;
          ours do, because that is the split the meter above is drawing. */}
      <div className={styles.tagRow}>
        {shown.map((board) => (
          <span
            key={board.key}
            className={cx(styles.tag, board.lead ? styles.tagGreen : null)}
          >{`${board.key} ${board.count.toLocaleString("ko-KR")}`}</span>
        ))}
        {otherCount > 0 ? (
          <span className={styles.tag}>{`기타 ${otherCount.toLocaleString("ko-KR")}`}</span>
        ) : null}
      </div>

      {previews.length === 0 ? null : (
        <div className={styles.savedTiles} data-count={previews.length}>
          {previews.map((preview) => (
            <span key={preview.id} className={styles.tile}>
              {/* Same-origin, locally cached media. The tile reserves its own box. */}
              <img src={preview.src} alt={preview.alt} loading="lazy" />
            </span>
          ))}
        </div>
      )}

      {/* `.saved-sources` — ref.css:262: the dot cluster left, the destination right. */}
      <div className={styles.savedFooter}>
        <SourceDots platforms={summary.sources} label="수집한 출처" />
        <Link
          href={toUrlObject(summary.href)}
          className={styles.savedLink}
          aria-label={`새로 저장된 ${summary.newItemCount.toLocaleString("ko-KR")}개 항목 모두 보기`}
        >
          모두 보기
        </Link>
      </div>
    </CardSurface>
  );
}
