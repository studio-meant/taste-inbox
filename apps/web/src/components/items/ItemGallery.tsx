"use client";

import type { MediaRef } from "@taste-inbox/shared";
import { ChevronLeft, ChevronRight, CirclePlay, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CollectedImage } from "@/components/media/CollectedImage";
import { cx } from "@/lib/cx";
import { instagramEmbedUrl } from "@/lib/instagram/embed";
import styles from "./ItemGallery.module.css";

type EmbedState = "idle" | "loading" | "loaded" | "failed";

/** A client leaf for looking through the media already stored with an item. */
export function ItemGallery({
  photos,
  title,
  originalUrl,
}: {
  readonly photos: readonly MediaRef[];
  readonly title: string;
  readonly originalUrl: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [embedState, setEmbedState] = useState<EmbedState>("idle");
  const active = photos[activeIndex];
  const embedUrl =
    active === undefined || active.type === "video_frame" ? instagramEmbedUrl(originalUrl) : null;

  useEffect(() => {
    if (embedState !== "loading") return;

    const timer = window.setTimeout(() => {
      setEmbedState((current) => (current === "loading" ? "failed" : current));
    }, 12_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [embedState]);

  if (active === undefined && embedUrl === null) return null;

  const hasMany = photos.length > 1;

  function move(step: -1 | 1): void {
    setActiveIndex((current) => (current + step + photos.length) % photos.length);
    setEmbedState("idle");
  }

  function select(index: number): void {
    setActiveIndex(index);
    setEmbedState("idle");
  }

  return (
    <div className={styles.gallery} data-item-gallery>
      <div
        className={cx(styles.stage, active === undefined ? styles.emptyStage : null)}
        data-gallery-stage
      >
        {active === undefined ? (
          <div className={styles.emptyBackdrop} aria-hidden="true">
            <CirclePlay size={56} strokeWidth={1.1} />
          </div>
        ) : (
          <CollectedImage className={styles.hero} src={active.src} alt={active.alt} />
        )}

        {active?.type === "video_frame" && embedUrl === null ? (
          <a
            className={styles.videoAction}
            href={originalUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <CirclePlay size={16} strokeWidth={1.8} aria-hidden="true" />
            원본에서 영상 재생
            <span className="visually-hidden">(새 탭에서 열림)</span>
          </a>
        ) : null}

        {embedUrl !== null && embedState === "idle" ? (
          <div className={styles.embedConsent} data-instagram-embed-consent>
            <button
              className={styles.embedButton}
              type="button"
              onClick={() => {
                setEmbedState("loading");
              }}
            >
              <CirclePlay size={18} strokeWidth={1.8} aria-hidden="true" />
              {active === undefined ? "Instagram 게시물 보기" : "앱에서 영상 재생"}
            </button>
            <span className={styles.embedNotice}>
              누르면 Instagram 공식 화면을 불러옵니다. 미디어는 따로 저장하지 않아요.
            </span>
          </div>
        ) : null}

        {embedUrl !== null && embedState !== "idle" ? (
          <div className={styles.embedPanel} data-instagram-embed data-state={embedState}>
            <div className={styles.embedToolbar}>
              <span>Instagram 공식 임베드</span>
              <div className={styles.embedToolbarActions}>
                <a
                  className={styles.embedExternal}
                  href={originalUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Instagram에서 열기
                  <ExternalLink size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span className="visually-hidden">(새 탭에서 열림)</span>
                </a>
                <button
                  className={styles.embedClose}
                  type="button"
                  aria-label="Instagram 게시물 닫기"
                  onClick={() => {
                    setEmbedState("idle");
                  }}
                >
                  <X size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>

            <iframe
              className={styles.embedFrame}
              src={embedUrl}
              title={`${title} Instagram 게시물`}
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="no-referrer"
              onLoad={() => {
                setEmbedState("loaded");
              }}
              onError={() => {
                setEmbedState("failed");
              }}
            />

            {embedState === "loading" ? (
              <div className={styles.embedStatus} role="status">
                Instagram 게시물을 불러오는 중이에요.
              </div>
            ) : null}

            {embedState === "failed" ? (
              <div className={styles.embedFailure} role="alert">
                <strong>이 게시물은 앱 안에서 재생할 수 없어요.</strong>
                <span>
                  비공개·삭제·임베드 차단 게시물일 수 있어요. 위의 원본 링크를 이용해 주세요.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {hasMany ? (
          <>
            <button
              className={cx(styles.arrow, styles.previous)}
              type="button"
              aria-label="이전 사진"
              onClick={() => {
                move(-1);
              }}
            >
              <ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              className={cx(styles.arrow, styles.next)}
              type="button"
              aria-label="다음 사진"
              onClick={() => {
                move(1);
              }}
            >
              <ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span className={styles.counter} aria-live="polite" aria-atomic="true">
              {activeIndex + 1} / {photos.length}
            </span>
          </>
        ) : null}
      </div>

      {hasMany ? (
        <div className={styles.thumbnails} aria-label={`${title} 사진 선택`}>
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              className={styles.thumbnail}
              type="button"
              aria-label={`${String(index + 1)}번째 사진 보기`}
              aria-pressed={index === activeIndex}
              onClick={() => {
                select(index);
              }}
            >
              <CollectedImage className={styles.thumbnailImage} src={photo.src} alt="" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
