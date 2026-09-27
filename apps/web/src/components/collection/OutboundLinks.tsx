import type { OutboundLink, OutboundLinkKind } from "@taste-inbox/shared";
import {
  CornerDownRight,
  ExternalLink,
  Link2,
  Package,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
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

const KIND: Readonly<Record<OutboundLinkKind, KindPresentation>> = {
  artifact: { icon: Package, description: "저장소 또는 모델" },
  shop: { icon: ShoppingBag, description: "작성자가 프로필에 적은 판매처" },
  resolved: { icon: CornerDownRight, description: "단축 링크를 따라간 목적지" },
  outbound: { icon: Link2, description: "게시물에 포함된 링크" },
  unresolved: { icon: ExternalLink, description: "단축 링크, 목적지 미확인" },
};

export function OutboundLinks({
  links,
  label = "바로가기",
}: {
  readonly links: readonly OutboundLink[];
  readonly label?: string;
}) {
  if (links.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <span className={styles.heading}>{label}</span>
      <ul className={styles.list} aria-label={label}>
        {links.map((link) => {
          const kind = KIND[link.kind];
          const Icon = kind.icon;
          return (
            <li key={link.id}>
              <a
                className={styles.link}
                href={link.url}
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
