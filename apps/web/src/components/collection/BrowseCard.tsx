import type { SourceRef } from "@taste-inbox/shared";
import type { StatusTone } from "@taste-inbox/ui/theme";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/primitives";
import { cx } from "@/lib/cx";
import { itemDetailHref, toUrlObject } from "@/lib/filters/board-filters";
import { APP_LOCALE, APP_TIME_ZONE, formatDateTime } from "@/lib/format/datetime";
import { SourceBadge } from "./SourceBadge";
import styles from "./BrowseCard.module.css";

/**
 * The Inbox card — `reference/ref.css` `.browse-card`.
 *
 * This owns the *shape*: the type eyebrow with the card's one action beside it, the title,
 * the tag row and the two-slot footer. What goes in the body arrives as children.
 *
 * The reference's flush media block held a photograph, which only Instagram ever supplied;
 * it went with Instagram on 2026-09-28. A starred repository has no picture, and a
 * generated one would be a fake photo of a real thing.
 *
 * Three slots in the reference held features that no longer exist and are not restored
 * here — "Ready · Local" and "Needs 7.8 GB" went with the sandbox runner (CLAUDE.md §8),
 * "Exact 92%" and "₩151,200" with product resolution (docs/DECISIONS.md, 2026-08-09). The
 * containers are ported and filled with what this product actually knows: what the signal
 * was, whether an enricher has looked at the item, and when it was first seen.
 */

export type BrowseCardSize = "wide" | "tall" | "medium" | "small";

const SPAN_CLASS: Readonly<Record<BrowseCardSize, string>> = {
  wide: styles.spanWide ?? "",
  tall: styles.spanTall ?? "",
  medium: styles.spanMedium ?? "",
  small: styles.spanSmall ?? "",
};

/**
 * The class the *article* wears — media heights and the hidden footer, not the span.
 *
 * `medium` has no entry in the stylesheet and resolves to "": it is the card with nothing
 * turned on, exactly as `.browse-card` with no size modifier is in the reference.
 */
const SIZE_CLASS: Readonly<Record<BrowseCardSize, string>> = {
  wide: styles.sizeWide ?? "",
  tall: styles.sizeTall ?? "",
  medium: styles.sizeMedium ?? "",
  small: styles.sizeSmall ?? "",
};

/** The class the *grid item* wears. `grid-row: span n` means nothing on the article. */
export function browseSpanClass(size: BrowseCardSize): string {
  return SPAN_CLASS[size];
}

/** `8. 9.` — short enough for an 11px footer slot, and stable between server and client. */
const SHORT_DATE = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  month: "numeric",
  day: "numeric",
});

/**
 * How far the entry stagger runs before every remaining card shares the last step.
 *
 * `--stagger-card` is 65ms and the Inbox holds over a hundred items: uncapped, the last card
 * would arrive seconds after the first, and the Inbox would be unusable while it assembled. Twelve steps is 795ms — the reference's own six-card board plus room, and
 * inside `--duration-shared-element`.
 */
const MAX_STAGGER_STEP = 11;

export interface BrowseCardStatus {
  readonly tone: StatusTone;
  readonly label: string;
  /** Announced instead of the abbreviation, so the state is never colour-only. */
  readonly ariaLabel: string;
}

/**
 * Whether an enricher has looked at this item yet.
 *
 * A fact about what the product has done, never a claim about the item — the distinction
 * DESIGN.md §3.5 exists to keep. `checkedAt` is null on every collected item today, which
 * is exactly why saying so is worth a slot.
 */
export function collectionStatus(checkedAt: string | null): BrowseCardStatus {
  return checkedAt === null
    ? { tone: "neutral", label: "확인 전", ariaLabel: "아직 확인하지 않은 항목입니다" }
    : { tone: "ready", label: "확인함", ariaLabel: "확인을 마친 항목입니다" };
}

export interface BrowseCardProps {
  readonly id: string;
  readonly size: BrowseCardSize;
  /** Position in the list — drives the entry stagger, nothing else. */
  readonly index: number;
  /** The kind of thing this is: `Repo`, `Paper`, `Dataset`. */
  readonly eyebrow: string;
  readonly title: string;
  readonly source: SourceRef;
  /** Names the destination, e.g. `저장소 열기`. Never names an action this product takes. */
  readonly openLabel: string;
  readonly status: BrowseCardStatus;
  readonly subtitle?: React.ReactNode;
  readonly tags?: readonly string[];
  /** Anything else the card needs in the body — its links. */
  readonly children?: React.ReactNode;
  /**
   * Where this item is investigated — `/focus/[itemId]`, which a person reads as the Lab.
   *
   * Supplying it draws the card's next action; omitting it draws nothing. Every collected
   * item can be opened there, so the Inbox passes it; Today's summary cards do not,
   * because they are a glance rather than a place to choose from.
   */
  readonly labHref?: string;
  /** Exact filtered Browse URL to restore after reading the detail page. */
  readonly returnHref?: string;
}

export function BrowseCard({
  id,
  size,
  index,
  eyebrow,
  title,
  source,
  openLabel,
  status,
  subtitle,
  tags = [],
  children,
  labHref,
  returnHref,
}: BrowseCardProps) {
  const headingId = `browse-${id}`;
  const firstSeen = new Date(source.firstSeenAt);

  /*
   * The top-right slot is the card's **action** where there is one (2026-09-28).
   *
   * It held the source badge — `Hugging Face 업보트`, linking out to the platform — which
   * is where the eye lands first on a card with no picture, and which is a label rather
   * than something to do. The Inbox exists to get one item into the Lab, so where
   * `labHref` is passed the slot is `Open in Lab`, and the badge moves into the link list
   * instead, at the top, where every other "somewhere else this points" already lives
   * (`OutboundLinks`).
   *
   * Without a `labHref` the badge stays where it was — the only route back to the platform.
   */
  const corner =
    labHref === undefined ? (
      <SourceBadge source={source} openLabel={openLabel} className={styles.badgeInline} />
    ) : (
      <Link className={cx(styles.lab, styles.labInline)} href={toUrlObject(labHref)}>
        <FlaskConical size={13} strokeWidth={1.9} aria-hidden="true" />
        <span lang="en">Open in Lab</span>
        <span className="visually-hidden">{` — ${title}`}</span>
        <span className={styles.labArrow} aria-hidden="true">
          →
        </span>
      </Link>
    );

  return (
    <article
      className={cx(styles.card, SIZE_CLASS[size])}
      style={{ ["--i" as string]: Math.min(index, MAX_STAGGER_STEP) }}
      aria-labelledby={headingId}
    >
      <div className={styles.body}>
        {/* The reference puts a "…" affordance at the right of this row. It has no target
            in this product, and a menu button that opens nothing is worse than none. */}
        <p className={styles.typeRow}>
          <span>{eyebrow}</span>
          {corner}
        </p>

        <h3
          id={headingId}
          className={cx(
            styles.title,
            size === "wide" ? "type-card-title-large" : "type-card-title",
          )}
        >
          <Link
            className={styles.titleLink}
            href={toUrlObject(itemDetailHref(id, returnHref))}
            scroll={false}
          >
            {title}
          </Link>
        </h3>

        {/* An empty description draws no row: an empty line is a gap, not a statement. */}
        {subtitle === undefined || subtitle === "" ? null : (
          <p className={cx(styles.subtitle, "type-body-small", "clamp-2")}>{subtitle}</p>
        )}

        <BrowseTags tags={tags} />

        {children}

        <div className={styles.foot}>
          <span className={styles.footStatus}>
            <StatusPill tone={status.tone} ariaLabel={status.ariaLabel}>
              {status.label}
            </StatusPill>
          </span>
          <time
            className={styles.footMeta}
            dateTime={source.firstSeenAt}
            title={`${formatDateTime(source.firstSeenAt)}에 처음 수집`}
          >
            {SHORT_DATE.format(firstSeen)}
          </time>
        </div>
      </div>
    </article>
  );
}

/**
 * How many tags a card prints before the rest become a count.
 *
 * Measured against the collected library rather than chosen: a GitHub repository carries
 * up to twenty topics and a Hugging Face model its whole tag list, and a card printing all
 * of them is a tag wall two thirds the height of the card with the title above it and the
 * next action buried under it. The Inbox card's job is **scan and choose**; the whole list
 * is one click away in the Lab, which is where depth belongs (docs/next_step UI §1.6).
 */
const VISIBLE_TAGS = 4;

/**
 * The topics the source wrote, with the first one greened and the tail counted.
 *
 * `tone: i === 0 ? 'green' : 'neutral'` in the reference. It is emphasis, not meaning — the
 * lead tag is not a different kind of tag — so nothing here depends on the colour.
 *
 * The `+N` is a count, not a control: there is nothing to expand into on a fixed-height
 * grid cell, and the full list is on the item's own page. It carries the remaining tags as
 * its accessible name, so nothing is hidden from a screen reader that is visible to a
 * sighted reader who clicks through.
 */
export function BrowseTags({ tags }: { readonly tags: readonly string[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, VISIBLE_TAGS);
  const rest = tags.slice(VISIBLE_TAGS);
  return (
    <ul className={styles.tagRow} aria-label="태그">
      {shown.map((tag, i) => (
        <li key={tag} className={cx(styles.tag, i === 0 ? styles.tagLead : null)}>
          {tag}
        </li>
      ))}
      {rest.length === 0 ? null : (
        <li className={cx(styles.tag, styles.tagRest)} title={rest.join(", ")}>
          +{rest.length}
          <span className="visually-hidden">
            {`그 밖의 태그 ${String(rest.length)}개: ${rest.join(", ")}`}
          </span>
        </li>
      )}
    </ul>
  );
}

/** Body content that carries its own controls, lifted clear of the stretched title link. */
export function BrowseCardExtras({ children }: { readonly children: React.ReactNode }) {
  return <div className={styles.extras}>{children}</div>;
}
