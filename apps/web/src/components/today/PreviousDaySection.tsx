import type { DaySummary, ItemDomain, SourcePlatform } from "@taste-inbox/shared";
import Link from "next/link";
import styles from "./Today.module.css";
import { cx } from "@/lib/cx";
import { toUrlObject } from "@/lib/filters/board-filters";
import { SourceMark } from "./SourceMark";

/**
 * Yesterday / timeline — IA §7.2, PAGE_SPECIFICATIONS §5.2, laid out as the reference's
 * `Yesterday` block (ref.js:497):
 *
 *   어제
 *   ┌──────────────────────────────┐ ┌──────────────────────────────┐
 *   │ ▨  Large-batch trainer       │ │ ▨  Grey pleated skirt        │
 *   │    GitHub Star · …   [Trends]│ │    Instagram Like · … [Style]│
 *   └──────────────────────────────┘ └──────────────────────────────┘
 *
 * Deliberately lighter than the three main modules: it is context, not a call to
 * action, and DESIGN.md §5.1 ranks it fourth of five. Hence the 66% glass at a smaller
 * radius, a fixed two-column strip across 68% of the content width, and an 18px heading
 * rather than the 25px section title.
 *
 * The reference's trailing pills read "Ready" and "78%" — a compatibility verdict and a
 * price match, both removed features. The slot keeps the board name instead, which is
 * something this payload actually carries.
 *
 * **The heading says how many there were.** `_highlights_for` returns at most three, and
 * the reference's heading is the bare word "Yesterday" — so a day that collected 142 items
 * rendered three cards under a label with no number, and three is what a person would
 * reasonably take the day to have been. `itemCount` was in the payload the whole time and
 * nothing drew it. A truncation that does not say it is one is not a summary; it is a wrong
 * answer with the right cards in it.
 */

const DOMAIN_LABEL: Readonly<Record<ItemDomain, string>> = {
  trends: "Trends",
  style: "Style",
  music: "Music",
  places: "Places",
  none: "None",
};

const COVER_CLASS: Readonly<Record<ItemDomain, string | undefined>> = {
  trends: styles.coverTrends,
  style: styles.coverStyle,
  music: styles.coverMusic,
  places: styles.coverPlaces,
  none: styles.coverNone,
};

/**
 * The cover's tint, per platform — the same colours the rail's source dots use.
 *
 * Every card used to wear one identical gradient, so a row of three said the same thing
 * three times. This is not decoration picked to look varied: it is the product's existing
 * per-source colour vocabulary, so the tint is something a person can come to read. It is
 * never the only signal — the card prints "Threads" underneath it in words.
 */
const COVER_TINT: Readonly<Record<SourcePlatform, string>> = {
  github: "--sun",
  instagram: "--wood",
  threads: "--light-green",
  linkedin: "--sage",
  huggingface: "--orchid",
  arxiv: "--light-wood",
  web: "--muted",
};

export function PreviousDaySection({ days }: { readonly days: readonly DaySummary[] }) {
  if (days.length === 0) {
    return null;
  }

  return (
    <section
      className={cx(styles.yesterdayBlock, styles.motionItem)}
      style={{ ["--i" as string]: "4" }}
      aria-label="지난 날의 하이라이트"
    >
      {days.map((day) => (
        <div key={day.date} className={styles.yesterdayBlock}>
          {/* The whole day, on the board's own calendar facet — the same `?day=` a person
              can set by hand from the rail, not a private route for this card. */}
          <h2 className={styles.yesterdayTitle}>
            <Link
              className={styles.yesterdayTitleLink}
              href={toUrlObject(`/library?day=${day.date}`)}
            >
              {day.label}
              <span className={styles.yesterdayTitleCount}>
                {`${day.itemCount.toLocaleString("ko-KR")}개`}
              </span>
            </Link>
          </h2>

          <ul className={styles.yesterdayCards}>
            {day.highlights.map((highlight) => (
              <li key={highlight.id}>
                <Link href={toUrlObject(highlight.href)} className={styles.yesterdayCard}>
                  {/*
                    `.mini-cover` — ref.css:274. The reference draws an abstract cover
                    because it has no data behind it. Where this product *does* have the
                    item's own thumbnail it shows that instead; where it does not — GitHub,
                    Threads and LinkedIn, whose media the collectors never cache — it keeps
                    the abstract cover rather than inventing a picture, and tints it by
                    source so a row of three is three different things.
                  */}
                  {highlight.preview === null ? (
                    <span
                      className={cx(styles.miniCover, COVER_CLASS[highlight.domain])}
                      style={{
                        ["--cover-tint" as string]: `var(${COVER_TINT[highlight.platform]})`,
                      }}
                      aria-hidden="true"
                    >
                      <span className={styles.miniMark}>
                        <SourceMark platform={highlight.platform} />
                      </span>
                    </span>
                  ) : (
                    /* A plain `img`, not `next/image`: the API serves these from the local
                       media cache at one fixed size, so an optimiser round trip would be
                       added to a 46px thumbnail that is already on this disk. */
                    <img
                      className={cx(styles.miniCover, styles.miniPhoto)}
                      src={highlight.preview}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <span className={styles.yesterdayCopy}>
                    <span className={styles.yesterdayCardTitle}>{highlight.title}</span>
                    <span className={styles.yesterdayMeta}>{highlight.meta}</span>
                  </span>
                  <span className={styles.tag} lang="en">
                    {DOMAIN_LABEL[highlight.domain]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {day.itemCount > day.highlights.length ? (
            // The heading already carries the day's real size, so this only has to be the
            // way there. Saying "3개만 보이는 중" as well repeated a number two lines above it.
            <p className={styles.yesterdayMore}>
              <Link href={toUrlObject(`/library?day=${day.date}`)}>전체 보기</Link>
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
