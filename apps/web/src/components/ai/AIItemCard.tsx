import type { AIItemCardModel, SourcePlatform } from "@taste-inbox/shared";
import {
  BrowseCard,
  BrowseCardExtras,
  collectionStatus,
  type BrowseCardSize,
} from "@/components/collection/BrowseCard";
import { OutboundLinks } from "@/components/collection/OutboundLinks";
import { kindLabel } from "@/components/collection/source-vocabulary";
import styles from "./AIItemCard.module.css";

/**
 * What the card's link actually does, named after where it goes.
 *
 * Named after the destination, never after an action the product performs. There is no
 * 바로 실행 to offer any more, and there never really was — this element has always been
 * an anchor to somebody else's page (DESIGN.md §3.5).
 */
const OPEN_SOURCE_LABEL: Readonly<Record<SourcePlatform, string>> = {
  github: "저장소 열기",
  huggingface: "Hugging Face에서 열기",
  arxiv: "논문 보기",
  web: "원본 보기",
};

/**
 * AIItemCard — the Inbox card, DESIGN.md §11.16 in the `ref.css` `.browse-card` shape.
 *
 * What it shows is what was collected: what kind of thing it is (the eyebrow — `Repo`,
 * `Paper`), the title, the text, the topics, where else it points, and the signal that put
 * it here.
 *
 * It used to carry an execution readiness pill and a memory meter. Both went with the
 * sandbox runner (docs/DECISIONS.md, 2026-08-09), and the reference's `Ready · Local` /
 * `Needs 7.8 GB` footer is the same removed feature — so the footer slot is filled with
 * whether an enricher has looked at the item yet, which is a fact about this product.
 *
 * The full text is not expanded in place. It is two clamped lines here and whole at
 * `/items/[id]`, which the card title links to: a fixed-height cell on a span grid cannot
 * hold a disclosure that doubles the card's height without shoving its neighbours down.
 */
export function AIItemCard({
  item,
  size = "medium",
  index = 0,
  labHref,
  returnHref,
}: {
  readonly item: AIItemCardModel;
  readonly size?: BrowseCardSize;
  readonly index?: number;
  /**
   * Where the Lab is, for this item. Passed straight through to `BrowseCard`, which draws
   * `Open in Lab` when it is given one — the Inbox passes it, Today's summary cards do not.
   */
  readonly labHref?: string;
  readonly returnHref?: string;
}) {
  return (
    <BrowseCard
      id={item.id}
      size={size}
      index={index}
      labHref={labHref}
      returnHref={returnHref}
      eyebrow={kindLabel(item.kind)}
      title={item.title}
      source={item.source}
      openLabel={OPEN_SOURCE_LABEL[item.source.platform]}
      status={collectionStatus(item.checkedAt)}
      tags={item.tags}
      subtitle={item.summary}
    >
      {/*
        Where else this item points — and, where the corner slot went to `Open in Lab`, the
        platform permalink leading the list. It is the same link the badge was; it has simply
        stopped being the loudest thing on the card.
      */}
      {labHref === undefined && item.links.length === 0 ? null : (
        <BrowseCardExtras>
          <div className={styles.links}>
            <OutboundLinks
              links={item.links}
              source={labHref === undefined ? undefined : item.source}
              showHeading={false}
              compact={3}
            />
          </div>
        </BrowseCardExtras>
      )}
    </BrowseCard>
  );
}
