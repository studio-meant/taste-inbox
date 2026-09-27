import type { SourceRef } from "@taste-inbox/shared";
import { ExternalLink } from "lucide-react";
import { cx } from "@/lib/cx";
import { sourceBadgeText } from "./source-vocabulary";
import styles from "./SourceBadge.module.css";

/** One original-post link for every platform, on image and text-only cards alike. */
export function SourceBadge({
  source,
  openLabel = "원본 게시물 열기",
  className,
}: {
  readonly source: SourceRef;
  readonly openLabel?: string;
  readonly className?: string;
}) {
  return (
    <a
      className={cx(styles.badge, className)}
      href={source.originalUrl}
      target="_blank"
      rel="noreferrer noopener"
    >
      <ExternalLink className={styles.icon} strokeWidth={2} aria-hidden="true" />
      <span>{sourceBadgeText(source)}</span>
      <span className="visually-hidden"> · {openLabel} </span>
      <span className="visually-hidden">(새 탭에서 열림)</span>
    </a>
  );
}
