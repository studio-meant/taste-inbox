"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cx } from "@/lib/cx";
import styles from "./CollectedImage.module.css";

/**
 * A thumbnail whose URL is expected to stop working.
 *
 * Instagram serves media from a signed CDN URL that expires within days, and the local
 * media cache does not exist yet (IMPLEMENTATION_PLAN Phase 2). Without this, every board
 * silently degrades to a grid of broken-image glyphs some time after collection, and the
 * failure looks like a bug in Taste Inbox rather than an expired link.
 *
 * So the failure is stated instead: the reserved aspect box keeps its size — the layout
 * never reflows — and says the original can no longer be loaded. The item itself is not
 * lost; its caption, tags and permalink are all still on the card.
 *
 * This is the only reason these cards touch the client. It stays a leaf: no data
 * fetching, no context, just one boolean.
 */
export function CollectedImage({
  src,
  alt,
  className,
}: {
  readonly src: string;
  readonly alt: string;
  readonly className?: string | undefined;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={cx(styles.fallback, className)}
        role="img"
        aria-label={`${alt} (불러오지 못함)`}
      >
        <ImageOff size={22} strokeWidth={1.5} aria-hidden="true" />
        <span className={styles.fallbackText}>원본 이미지를 더 이상 불러올 수 없어요</span>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
