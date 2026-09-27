import type { OutboundLink, OutboundLinkKind, SourceRef } from "@taste-inbox/shared";
import {
  Bookmark,
  CornerDownRight,
  ExternalLink,
  Link2,
  Package,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { sourceBadgeText } from "./source-vocabulary";
import styles from "./OutboundLinks.module.css";

/**
 * Where else an item points, on every board.
 *
 * The card's own source link answers "where did this come from". This answers "what is it
 * actually about", which for a LinkedIn post whose subject is a paper on another domain is
 * the question the user came with.
 *
 * Three things it will not do:
 *
 * - **Claim a destination it has not seen.** The label is the host, because that is
 *   derivable from the URL. A page title would have to be fetched, and rendering a card
 *   never causes a request.
 * - **Hide a shortener it could not follow.** `unresolved` is shown and labelled as such.
 *   The resolver failing is not a reason to take away a working click.
 * - **Distinguish by colour alone.** Every kind carries an icon and words (CLAUDE.md §6).
 */

interface KindPresentation {
  readonly icon: LucideIcon;
  /** Read by screen readers before the host, so the kind is never colour-only. */
  readonly description: string;
}

const KIND: Readonly<Record<OutboundLinkKind | "source", KindPresentation>> = {
  artifact: { icon: Package, description: "저장소 또는 모델" },
  source: { icon: Bookmark, description: "이 항목을 남긴 곳" },
  shop: { icon: ShoppingBag, description: "작성자가 프로필에 적은 판매처" },
  resolved: { icon: CornerDownRight, description: "단축 링크를 따라간 목적지" },
  outbound: { icon: Link2, description: "게시물에 포함된 링크" },
  unresolved: { icon: ExternalLink, description: "단축 링크, 목적지 미확인" },
};

/**
 * The platform link, as the first row of this list.
 *
 * It used to be the card's top-right badge, which put a label where the card's one action
 * belongs (`BrowseCard`, 2026-09-28). It is still exactly what it was — where this item
 * came from and how to get back to it — so it joins the list of everywhere else this item
 * points, at the top, because it is the one link that is about the item itself.
 *
 * Synthesised rather than stored: `SourceRef` already carries the permalink and the
 * vocabulary, and adding a row to the database for something both are already able to say
 * would be a second source of truth for one fact.
 */
type Row = OutboundLink | (Omit<OutboundLink, "kind"> & { readonly kind: "source" });

function sourceRow(source: SourceRef): Row {
  return {
    id: `source-${source.platform}`,
    url: source.originalUrl,
    label: sourceBadgeText(source),
    kind: "source",
    origin: "post",
    via: null,
  };
}

export function OutboundLinks({
  links,
  source,
  label = "바로가기",
  showHeading = true,
}: {
  readonly links: readonly OutboundLink[];
  /** When given, the platform permalink leads the list. */
  readonly source?: SourceRef;
  readonly label?: string;
  /**
   * The `바로가기` caption over the list.
   *
   * Off on the Inbox card, where the row of link chips reads as links without being told
   * so and the caption was one more line between the title and the next action.
   */
  readonly showHeading?: boolean;
}) {
  const rows: readonly Row[] = source === undefined ? links : [sourceRow(source), ...links];
  if (rows.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {showHeading ? <span className={styles.heading}>{label}</span> : null}
      <ul className={styles.list} aria-label={label}>
        {rows.map((link) => {
          const kind = KIND[link.kind];
          const Icon = kind.icon;
          return (
            <li key={link.id}>
              <a
                className={styles.link}
                href={link.url}
                data-source={link.kind === "source" ? "" : undefined}
                target="_blank"
                rel="noreferrer noopener"
                /*
                 * The full URL on hover. The visible label is only the host, so this is
                 * where a user checks where a click actually goes before making it.
                 */
                title={link.via === null ? link.url : `${link.url}\n(${link.via} 에서 따라감)`}
              >
                <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
                <span className="visually-hidden">{kind.description}: </span>
                <span className={styles.host}>{link.label}</span>
                {link.origin === "post" ? null : (
                  <span className={styles.origin}>
                    {link.origin === "comment" ? "댓글" : "프로필"}
                  </span>
                )}
                <span className="visually-hidden">(새 탭에서 열림)</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
