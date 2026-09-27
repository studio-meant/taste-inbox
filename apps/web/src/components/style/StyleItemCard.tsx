import type { ItemBoard, StyleItemCardModel } from "@taste-inbox/shared";
import { ImageOff } from "lucide-react";
import {
  BrowseCard,
  BrowseCardExtras,
  collectionStatus,
  type BrowseCardSize,
} from "@/components/collection/BrowseCard";
import { OutboundLinks } from "@/components/collection/OutboundLinks";
import { CollectedImage } from "@/components/media/CollectedImage";
import { cx } from "@/lib/cx";
import styles from "./StyleItemCard.module.css";

/**
 * StyleItemCard — DESIGN.md §11.17, image-led, in the Saved Items card shape.
 *
 * **The board does not resolve products.** No shopping search, no image search, no brand
 * and no price — the user's decision, and the same removal the AI card went through when
 * the sandbox runner left (docs/DECISIONS.md, 2026-08-09). The reference's `Exact 92%` and
 * `₩151,200` are that removed feature drawn back in, so neither is ported; the footer slot
 * they sat in is, filled with whether an enricher has looked at the item and when it was
 * first seen.
 *
 * The gallery treats one photo and ten the same way — a carousel used to lose everything
 * past its cover at capture time, and one entry is simply the short case of the same list.
 * It fills the card's flush media block. BrowseCard reserves the cover ratio separately
 * from the body, so profile links and metadata always have room below the picture.
 */
export function StyleItemCard({
  item,
  size = "tall",
  index = 0,
  board,
  returnHref,
}: {
  readonly item: StyleItemCardModel;
  readonly size?: BrowseCardSize;
  readonly index?: number;
  /** The board the page is showing; `BrowseCard` draws the picker when it is given one. */
  readonly board?: ItemBoard;
  readonly returnHref?: string;
}) {
  const photos = item.media;
  // The name a person recognises, with the handle beside it — `주연 (@juuuyeonn)`. The
  // handle alone is what the post carries; the name only exists once the profile is read,
  // and 60 of the board's 61 accounts have one.
  const author = item.author;
  const handle = author?.handle ?? item.source.author;
  const attribution =
    handle == null
      ? item.source.label
      : author?.displayName
        ? `${author.displayName} (@${handle})`
        : `@${handle}`;
  // A post with more than one photo has something to scroll, so the strip becomes a
  // keyboard-reachable region and says how many photos are in it. On a single photo both
  // would be furniture: an extra tab stop, and a count of one.
  const hasMany = photos.length > 1;
  const shopLinks = author?.links ?? [];
  /*
   * `descriptor` is the caption's lead line, so it is the card's title. Printing the whole
   * caption underneath would repeat that line verbatim; what follows it is the part the
   * title does not already say.
   */
  const rest = (
    item.caption.startsWith(item.descriptor)
      ? item.caption.slice(item.descriptor.length)
      : item.caption
  ).trim();

  return (
    <BrowseCard
      id={item.id}
      size={size}
      index={index}
      board={board}
      returnHref={returnHref}
      eyebrow="Style"
      title={item.descriptor}
      source={item.source}
      openLabel="원본 보기"
      status={collectionStatus(item.checkedAt)}
      tags={item.tags}
      subtitle={rest === "" ? undefined : rest}
      media={
        photos.length === 0 ? (
          <div className={styles.frameEmpty} role="img" aria-label="사진이 없는 게시물">
            <ImageOff size={22} strokeWidth={1.5} aria-hidden="true" />
          </div>
        ) : (
          <>
            <ul
              className={styles.gallery}
              aria-label={`게시물 사진 ${String(photos.length)}장`}
              {...(hasMany ? { tabIndex: 0 } : {})}
            >
              {photos.map((photo) => (
                <li key={photo.id} className={styles.frame}>
                  {/* Local-first app reading a remote CDN photo; next/image would add a
                      proxy hop for no benefit and the block's height is already reserved.
                      The URL is signed and expires, so the load failure is a designed
                      state. */}
                  <CollectedImage src={photo.src} alt={photo.alt} />
                </li>
              ))}
            </ul>
            {hasMany ? (
              // Bottom-right, separate from the original-post link above it.
              <span className={cx(styles.count, "type-body-small")} aria-hidden="true">
                {photos.length}장
              </span>
            ) : null}
          </>
        )
      }
    >
      <BrowseCardExtras>
        {/* Usually empty here, and never fetched: a caption that linked a shop is the
            one thing on this board that is already actionable. */}
        <OutboundLinks links={item.links} />
        {/*
          Where to buy it. Kept apart from the post's own links because it is a weaker
          claim about *this* photo and a stronger one about the account: the shop is what
          the poster sells in general, not necessarily the garment in the picture.
          Measured — 64 of the board's 76 cards can offer one, and almost none of them
          could from the post alone.
        */}
        <OutboundLinks links={shopLinks} label="작성자의 판매처" />

        <p className={cx(styles.meta, "type-body-small")}>{attribution}</p>
      </BrowseCardExtras>
    </BrowseCard>
  );
}
