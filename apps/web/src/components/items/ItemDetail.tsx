import type { EvidenceRef, ItemDetailModel } from "@taste-inbox/shared";
import {
  ArrowLeft,
  Crosshair,
  Check,
  CircleCheck,
  ExternalLink,
  Lightbulb,
  Radio,
  ShieldAlert,
  Telescope,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";
import { OutboundLinks } from "@/components/collection/OutboundLinks";
import { sourceBadgeText } from "@/components/collection/source-vocabulary";
import { cx } from "@/lib/cx";
import { toUrlObject } from "@/lib/filters/board-filters";
import { instagramEmbedUrl } from "@/lib/instagram/embed";
import { BOARD_BACK_LABEL, BOARD_HREF, BOARD_LABEL } from "@/lib/navigation/boards";
import { ItemGallery } from "./ItemGallery";
import styles from "./ItemDetail.module.css";

/** What a piece of evidence is, and how much it is allowed to claim. */
const PROVENANCE: Readonly<
  Record<EvidenceRef["provenance"], { readonly label: string; readonly icon: typeof Radio }>
> = {
  fact: { label: "관찰됨", icon: CircleCheck },
  inference: { label: "추론", icon: Lightbulb },
  external: { label: "외부 확인", icon: Radio },
  // Added 2026-09-28. The three above say what *kind* of claim a row is; these four say
  // *who made it*, and the screens now carry claims from three different machines. A
  // reader has to be able to tell a sandbox observation from a research citation.
  huggingface: { label: "Hugging Face가 밝힘", icon: Radio },
  aiq: { label: "AI-Q 조사", icon: Telescope },
  sandbox: { label: "샌드박스 실행", icon: TerminalSquare },
  // Not a log line. A blocked egress attempt is a finding, and it is drawn as one.
  policy: { label: "정책이 차단", icon: ShieldAlert },
};

function EvidenceRow({ evidence }: { readonly evidence: EvidenceRef }) {
  const provenance = PROVENANCE[evidence.provenance];
  const Icon = provenance.icon;
  return (
    <li className={styles.evidence}>
      <div className={styles.evidenceHead}>
        <span className={cx(styles.evidenceLabel, "type-body-small")}>{evidence.label}</span>
        <span className={cx(styles.provenance, "type-body-small")}>
          <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
          {provenance.label}
        </span>
      </div>
      <p className={cx(styles.evidenceValue, "type-body-small")}>{evidence.value}</p>
    </li>
  );
}

export function ItemDetail({
  item,
  backHref,
}: {
  readonly item: ItemDetailModel;
  readonly backHref?: string;
}) {
  const author = item.author;
  const handle = author?.handle ?? item.source.author;
  const attribution =
    handle == null
      ? item.source.label
      : author?.displayName
        ? `${author.displayName} (@${handle})`
        : `@${handle}`;
  const hasDestinations =
    item.links.length > 0 || (author?.links.length ?? 0) > 0 || (author?.mentions.length ?? 0) > 0;
  const evidenceCount = item.evidence.length;
  const hasOfficialInstagramEmbed = instagramEmbedUrl(item.source.originalUrl) !== null;
  const hasVisual = item.photos.length > 0 || hasOfficialInstagramEmbed;

  return (
    <article className={styles.page} data-board={item.board ?? "unfiled"} data-item-detail>
      <div className={styles.toolbar}>
        {item.board === null ? (
          <span />
        ) : (
          <Link
            className={styles.back}
            href={toUrlObject(backHref ?? BOARD_HREF[item.board])}
            scroll={false}
          >
            <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
            {BOARD_BACK_LABEL[item.board]}
          </Link>
        )}
        <span className={styles.toolbarSource}>{sourceBadgeText(item.source)}</span>
      </div>

      <div className={cx(styles.sheet, hasVisual ? null : styles.noMedia)}>
        {hasVisual ? (
          <div className={styles.visual}>
            <ItemGallery
              photos={item.photos}
              title={item.title}
              originalUrl={item.source.originalUrl}
            />
          </div>
        ) : null}

        <div className={styles.story}>
          <header className={styles.head}>
            <div className={styles.kicker}>
              {item.board === null ? null : (
                <span className={styles.boardChip} lang="en">
                  {BOARD_LABEL[item.board]}
                </span>
              )}
              <span>{sourceBadgeText(item.source)}</span>
            </div>
            <h1 className={cx(styles.title, "type-page-title")}>{item.title}</h1>
            <p className={cx(styles.meta, "type-body-small")}>{attribution}</p>
            <a
              className={styles.original}
              href={item.source.originalUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <span>원본 게시물 열기</span>
              <ExternalLink size={15} strokeWidth={1.75} aria-hidden="true" />
              <span className="visually-hidden">(새 탭에서 열림)</span>
            </a>
            {/* The deeper screen for one item: its research, the step it can take, and a
                sandboxed run (PAGE_SPECIFICATIONS §6.1). Entered from here rather than from
                the navigation, which this change does not redesign. */}
            <Link className={styles.focusLink} href={`/focus/${item.id}`}>
              <Crosshair size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>Focus Canvas 열기</span>
              <span className={styles.focusHint}>조사 · 안전한 실행</span>
            </Link>
          </header>

          <section className={styles.contentSection} aria-labelledby="item-body-title">
            <h2 id="item-body-title" className={styles.eyebrow}>
              본문
            </h2>
            {item.body.trim() === "" ? (
              <p className={cx(styles.empty, "type-body-small")}>본문이 없는 게시물이에요.</p>
            ) : (
              <p className={cx(styles.body, "type-body")}>{item.body}</p>
            )}

            {item.tags.length === 0 ? null : (
              <ul className={styles.tags} aria-label="해시태그">
                {item.tags.map((tag) => (
                  <li key={tag} className={styles.tag}>
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {hasDestinations ? (
            <section className={styles.contentSection} aria-labelledby="item-links-title">
              <h2 id="item-links-title" className={styles.eyebrow}>
                연결된 곳
              </h2>
              <div className={styles.destinations}>
                <OutboundLinks links={item.links} label="게시물이 가리키는 곳" />
                <OutboundLinks links={author?.links ?? []} label="작성자의 판매처" />
                {author?.mentions.length ? (
                  <div className={styles.mentions}>
                    <span className={styles.mentionsLabel}>소개글에서 언급한 계정</span>
                    <ul className={styles.mentionList} aria-label="작성자가 언급한 계정">
                      {author.mentions.map((mention) => (
                        <li key={mention}>
                          <a
                            className={styles.mention}
                            href={`https://www.instagram.com/${encodeURIComponent(mention)}/`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            @{mention}
                            <span className="visually-hidden">(새 탭에서 열림)</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <div className={styles.lower}>
          <details className={styles.evidenceDisclosure}>
            <summary className={styles.evidenceSummary}>
              <span>
                <Check size={15} strokeWidth={1.8} aria-hidden="true" />
                확인한 정보
              </span>
              <span className={styles.evidenceCount}>{evidenceCount}개</span>
            </summary>
            <div className={styles.evidenceBody}>
              {evidenceCount === 0 ? (
                <p className={cx(styles.empty, "type-body-small")}>
                  {item.checkedAt === null
                    ? "아직 아무것도 확인하지 않았어요."
                    : "확인했지만 기록할 만한 것이 없었어요."}
                </p>
              ) : (
                <ul className={styles.evidenceList}>
                  {item.evidence.map((row) => (
                    <EvidenceRow key={row.id} evidence={row} />
                  ))}
                </ul>
              )}
            </div>
          </details>

          <p className={cx(styles.footnote, "type-body-small")}>
            처음 수집: <time dateTime={item.firstSeenAt}>{item.firstSeenAt.slice(0, 10)}</time>
            {item.sourcePublishedAt === null ? null : (
              <>
                {" · "}작성:{" "}
                <time dateTime={item.sourcePublishedAt}>{item.sourcePublishedAt.slice(0, 10)}</time>
              </>
            )}
          </p>
        </div>
      </div>
    </article>
  );
}
