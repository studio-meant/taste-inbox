import type { AIItemCardModel, AIItemKind, ItemBoard, SourcePlatform } from "@taste-inbox/shared";
import {
  BrowseCard,
  BrowseCardExtras,
  collectionStatus,
  type BrowseCardSize,
} from "@/components/collection/BrowseCard";
import { OutboundLinks } from "@/components/collection/OutboundLinks";
import { CollectedImage } from "@/components/media/CollectedImage";
import styles from "./AIItemCard.module.css";

/**
 * What the card's link actually does, named after where it goes.
 *
 * Named after the destination, never after an action the product performs. There is no
 * 바로 실행 to offer any more, and there never really was — this element has always been
 * an anchor to somebody else's page (DESIGN.md §3.5). It now labels the source badge that
 * floats on the media block, which is the same anchor in the reference's position.
 */
const OPEN_SOURCE_LABEL: Readonly<Record<SourcePlatform, string>> = {
  github: "저장소 열기",
  huggingface: "Hugging Face에서 열기",
  arxiv: "논문 보기",
  threads: "원본 게시물 보기",
  linkedin: "원본 게시물 보기",
  instagram: "원본 게시물 보기",
  web: "원본 보기",
};

/**
 * What the item is, in the eyebrow slot — `.browse-type-row`.
 *
 * The reference prints a literal `it.type` (`AI Tool`, `Research`, `Model`); ours comes
 * from `AIItemKindSchema`, which is the same distinction the product can actually make.
 * `lib/filters/facets.ts` keeps its own copy for the filter chips, keyed by URL value.
 */
const KIND_LABEL: Readonly<Record<AIItemKind, string>> = {
  repo: "저장소",
  model: "모델",
  dataset: "데이터셋",
  space: "Space",
  paper: "논문",
  demo: "데모",
  tool: "도구",
  post: "게시물",
};

/**
 * AIItemCard — DESIGN.md §11.16, in the Saved Items card shape (`ref.css` `.browse-card`).
 *
 * What it shows is what was collected: what kind of thing it is, the post's own picture,
 * the title, the text, the hashtags the author wrote, where else it points, and the signal
 * that put it here.
 *
 * It used to carry an execution readiness pill and a memory meter. Both went with the
 * sandbox runner (docs/DECISIONS.md, 2026-08-09), and the reference's `Ready · Local` /
 * `Needs 7.8 GB` footer is the same removed feature — so the footer slot is filled with
 * whether an enricher has looked at the item yet, which is a fact about this product.
 *
 * The full post is no longer expanded in place. It is two clamped lines here and whole at
 * `/items/[id]`, which the card title links to: a fixed-height cell on a span grid cannot
 * hold a disclosure that doubles the card's height without shoving its neighbours down.
 */
export function AIItemCard({
  item,
  size = "medium",
  index = 0,
  board,
  labHref,
  returnHref,
}: {
  readonly item: AIItemCardModel;
  readonly size?: BrowseCardSize;
  readonly index?: number;
  /**
   * The board the page is showing. Passed straight through to `BrowseCard`, which draws the
   * picker when it is given one — three boards render this card (`/trends`, `/places`,
   * `/none`) plus the merged `/library`, and each of them knows which it is.
   */
  readonly board?: ItemBoard;
  /**
   * Where the Lab is, for this item. Passed straight through to `BrowseCard`, which draws
   * `Open in Lab` when it is given one — every Inbox board passes it, Today's summary
   * cards do not.
   */
  readonly labHref?: string;
  readonly returnHref?: string;
}) {
  return (
    <BrowseCard
      id={item.id}
      size={size}
      index={index}
      board={board}
      labHref={labHref}
      returnHref={returnHref}
      eyebrow={KIND_LABEL[item.kind]}
      title={item.title}
      source={item.source}
      openLabel={OPEN_SOURCE_LABEL[item.source.platform]}
      status={collectionStatus(item.checkedAt)}
      tags={item.tags}
      subtitle={item.summary}
      media={
        item.preview === null ? null : (
          <CollectedImage src={item.preview.src} alt={item.preview.alt} />
        )
      }
    >
      {/* The repository or paper the post is about. On this board most items are
          Threads and LinkedIn reposts whose subject lives on another domain. */}
      {/*
        Where else this item points — and, on a board that took the corner slot for
        `Open in Lab`, the platform permalink leading the list. It is the same link the
        badge was; it has simply stopped being the loudest thing on the card.
      */}
      {labHref === undefined && item.links.length === 0 ? null : (
        <BrowseCardExtras>
          <div className={styles.links}>
            <OutboundLinks
              links={item.links}
              source={labHref === undefined ? undefined : item.source}
              showHeading={false}
            />
          </div>
        </BrowseCardExtras>
      )}
    </BrowseCard>
  );
}
