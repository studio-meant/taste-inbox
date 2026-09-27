import type { ItemBoard, SourceRef } from "@taste-inbox/shared";
import type { StatusTone } from "@taste-inbox/ui/theme";
import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/primitives";
import { BoardPicker } from "./BoardPicker";
import { cx } from "@/lib/cx";
import { itemDetailHref, toUrlObject } from "@/lib/filters/board-filters";
import { APP_LOCALE, APP_TIME_ZONE, formatDateTime } from "@/lib/format/datetime";
import { SourceBadge } from "./SourceBadge";
import styles from "./BrowseCard.module.css";

/**
 * The card every Browse board shares — `reference/ref.css` `.browse-card`.
 *
 * DESIGN.md §33 is explicit that the boards share structure and not the inside of a card,
 * so this owns the *shape*: the flush media block, the floating source badge, the type
 * eyebrow, the title, the tag row and the two-slot footer. What goes in the body is the
 * board's own business and arrives as children.
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

/**
 * How much room an item gets — a pure function of the item, so the server and the client
 * agree and a reload never reshuffles the board.
 *
 * The reference authors `size` per item by hand, which is not something a board of 126
 * collected items can do. The rule below says the same thing the reference's own six cards
 * say, in terms the product can actually measure:
 *
 * - nothing to show → one row, and the media block is hidden outright
 * - the newest item on the board leads it, two columns wide
 * - a carousel, or a portrait cover, is worth the height
 * - everything else is the ordinary two-row card
 */
export function browseCardSize({
  index,
  mediaCount,
  portrait,
}: {
  readonly index: number;
  readonly mediaCount: number;
  readonly portrait: boolean;
}): BrowseCardSize {
  if (mediaCount === 0) return "small";
  if (index === 0) return "wide";
  if (mediaCount > 1 || portrait) return "tall";
  return "medium";
}

/** True when the cover is taller than it is wide. Unknown dimensions are not portrait. */
export function isPortrait(media: { width?: number | null; height?: number | null } | null) {
  if (media == null) return false;
  const { width, height } = media;
  return width != null && height != null && height > width;
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
 * `--stagger-card` is 65ms and the Style board holds 76 items: uncapped, the last card
 * would arrive 4.9 seconds after the first, and the board would be unusable while it
 * assembled. Twelve steps is 795ms — the reference's own six-card board plus room, and
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
  /** Position on the board — drives the entry stagger, nothing else. */
  readonly index: number;
  /** The kind of thing this is: `저장소`, `Style`, `Music`. */
  readonly eyebrow: string;
  readonly title: string;
  readonly source: SourceRef;
  /** Names the destination, e.g. `저장소 열기`. Never names an action this product takes. */
  readonly openLabel: string;
  readonly status: BrowseCardStatus;
  /** Fills the flush block at the top. Omitted entirely on a card with no picture. */
  readonly media?: React.ReactNode;
  readonly subtitle?: React.ReactNode;
  readonly tags?: readonly string[];
  /** Anything else the board needs in the body — links, galleries, disclosures. */
  readonly children?: React.ReactNode;
  /**
   * Which board this item is on, when the page rendering the card knows.
   *
   * Supplying it draws the board picker; omitting it draws nothing. That is what keeps the
   * control off the surfaces where it would be a claim rather than a correction — Today's
   * summary cards show items from every board at once and are not a board being scanned,
   * so they pass nothing and get nothing.
   *
   * The board comes from the *page*, not from the card model, and that is deliberate. A page
   * always knows which board it is: `/style` is style, and `/library` knows because
   * `mergeBoards` tagged every entry to choose a card component for it. Adding the field to
   * three card models to re-derive what the caller already has would be three schema
   * changes, three mappers and a fourth place for the answer to be wrong.
   */
  readonly board?: ItemBoard;
  /**
   * Where this item is investigated — `/focus/[itemId]`, which a person reads as the Lab.
   *
   * Supplying it draws the card's next action; omitting it draws nothing. Every collected
   * item can be opened there, so every Inbox board passes it; Today's summary cards do
   * not, because they are a glance rather than a place to choose from.
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
  media,
  subtitle,
  tags = [],
  children,
  board,
  labHref,
  returnHref,
}: BrowseCardProps) {
  const headingId = `browse-${id}`;
  const firstSeen = new Date(source.firstSeenAt);
  const hasMedia = size !== "small" && media !== undefined && media !== null;

  /*
   * The top-right slot is the card's **action** where there is one (2026-09-28).
   *
   * It held the source badge — `Hugging Face 업보트`, linking out to the platform — which
   * is where the eye lands first on a card with no picture, and which is a label rather
   * than something to do. The Inbox exists to get one item into the Lab, so on a board
   * that passes `labHref` the slot is `Open in Lab`, and the board moves the badge into
   * the link list instead, at the top, where every other "somewhere else this points"
   * already lives (`OutboundLinks`).
   *
   * Without a `labHref` the badge stays exactly where it was. Today's summary cards and
   * any board that does not offer the Lab keep the only route back to the platform they
   * have ever had.
   */
  const corner =
    labHref === undefined ? (
      <SourceBadge
        source={source}
        openLabel={openLabel}
        className={hasMedia ? styles.badgeFloating : styles.badgeInline}
      />
    ) : (
      <Link
        className={cx(styles.lab, hasMedia ? styles.labFloating : styles.labInline)}
        href={toUrlObject(labHref)}
      >
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
      {hasMedia ? (
        <div className={styles.media}>
          <div className={styles.mediaFill}>{media}</div>
          {corner}
        </div>
      ) : null}

      <div className={styles.body}>
        {/* The reference puts a "…" affordance at the right of this row. It has no target
            in this product, and a menu button that opens nothing is worse than none. */}
        <p className={styles.typeRow}>
          <span>{eyebrow}</span>
          {hasMedia ? null : corner}
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

        {subtitle === undefined ? null : (
          <p className={cx(styles.subtitle, "type-body-small", "clamp-2")}>{subtitle}</p>
        )}

        <BrowseTags tags={tags} />

        {children}

        {/*
          Above the footer rather than in it, and that is not a layout preference. The
          footer is `display: none` on a `small` card — the size a post with no picture
          gets — and a liked Instagram post very often has no picture at all, because the
          Likes grid hands over no image (`ingest/captures.py::ingest_likes_file`). Put in
          the footer, the one control this feature exists for would have been invisible on
          exactly the items that most need correcting.
        */}
        {board === undefined ? null : (
          <BoardPicker itemId={id} board={board} itemTitle={title} compact />
        )}

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
 * The hashtags the author wrote, with the first one greened and the tail counted.
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
    <ul className={styles.tagRow} aria-label="해시태그">
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
