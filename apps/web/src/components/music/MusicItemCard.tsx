import type {
  ItemBoard,
  MusicItemCardModel,
  MusicMatchGrade,
  MusicService,
  MusicTrackCandidate,
} from "@taste-inbox/shared";
import type { StatusTone } from "@taste-inbox/ui/theme";
import {
  Check,
  CircleHelp,
  Disc3,
  ExternalLink,
  ListMusic,
  Repeat,
  ScanSearch,
  ScanText,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { BoardPicker } from "@/components/collection/BoardPicker";
import { collectionStatus } from "@/components/collection/BrowseCard";
import { OutboundLinks } from "@/components/collection/OutboundLinks";
import { SourceBadge } from "@/components/collection/SourceBadge";
import { CollectedImage } from "@/components/media/CollectedImage";
import { StatusPill } from "@/components/primitives";
import { cx } from "@/lib/cx";
import { itemDetailHref, toUrlObject } from "@/lib/filters/board-filters";
import { APP_LOCALE, APP_TIME_ZONE, formatDateTime } from "@/lib/format/datetime";
import styles from "./MusicItemCard.module.css";

/**
 * A saved music-recommendation Reel.
 *
 * Three things this card is careful about:
 *
 * - **Zero candidates is normal.** When the song list is only on screen or only spoken,
 *   extraction finds nothing. The card still shows the caption and links to the Reel,
 *   which is enough to stop forgetting — the whole point of shipping the list first.
 * - **Fact beside inference.** The observed string is always rendered next to any
 *   resolved artist/title, so a guess can never be mistaken for a confirmed match
 *   (DESIGN.md §3.5).
 * - **Hand-off, not write.** The action is a prefilled search the user completes. A
 *   search cannot save the wrong song.
 */

interface GradePresentation {
  readonly pillText: string;
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: LucideIcon;
}

const GRADE: Readonly<Record<MusicMatchGrade, GradePresentation>> = {
  exact: { pillText: "Exact match", label: "정확히 확인됨", tone: "ready", icon: Check },
  likely: { pillText: "Likely match", label: "유력한 후보", tone: "info", icon: Sparkles },
  // Its own grade, not a variant of exact: a sped-up edit is a different recording.
  different_version: {
    pillText: "Different version",
    label: "다른 버전",
    tone: "warning",
    icon: Repeat,
  },
  similar: { pillText: "Similar", label: "유사한 곡", tone: "neutral", icon: ScanSearch },
  unknown: { pillText: "Not identified", label: "확인 필요", tone: "neutral", icon: CircleHelp },
};

/**
 * The link's label, keyed by where it goes.
 *
 * A `Record` rather than a fixed string: adding a service to `MusicServiceSchema` makes
 * this map incomplete and fails the build, so a new destination cannot ship under the old
 * destination's name (docs/DECISIONS.md, 2026-08-08 — "링크는 목적지 이름으로").
 */
const SEARCH_LABEL: Readonly<Record<MusicService, string>> = {
  youtube_music: "YouTube Music에서 찾기",
};

function CandidateRow({ candidate }: { readonly candidate: MusicTrackCandidate }) {
  const grade = GRADE[candidate.matchGrade];
  const resolved = candidate.artist !== null && candidate.title !== null;

  return (
    <li className={cx(styles.candidate, candidate.handledAt !== null && styles.handled)}>
      <div className={styles.candidateHead}>
        {candidate.ordinal === null ? null : (
          <span className={styles.ordinal} aria-hidden="true">
            {candidate.ordinal}
          </span>
        )}
        {resolved ? (
          <span className={cx(styles.resolved, "type-body-small")}>
            {candidate.artist} — {candidate.title}
          </span>
        ) : (
          <span className={cx(styles.resolved, "type-body-small")}>{candidate.rawText}</span>
        )}
        <StatusPill tone={grade.tone} icon={grade.icon} ariaLabel={grade.label}>
          <span lang="en">{grade.pillText}</span>
        </StatusPill>
      </div>

      {/* Only when it would otherwise be hidden behind the resolved name. */}
      {resolved ? (
        <p className={cx(styles.rawText, "type-body-small")}>
          <span className="visually-hidden">릴스에 적힌 원문: </span>
          {candidate.rawText}
        </p>
      ) : null}

      <div className={styles.candidateActions}>
        <a
          className={styles.searchLink}
          href={candidate.searchUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          {SEARCH_LABEL[candidate.service]}
          <span className="visually-hidden">(새 탭에서 열림)</span>
        </a>
      </div>
    </li>
  );
}

function candidateName(candidate: MusicTrackCandidate): string {
  return candidate.artist !== null && candidate.title !== null
    ? `${candidate.artist} — ${candidate.title}`
    : candidate.rawText;
}

function shelfTitle(item: MusicItemCardModel): string {
  const first = item.candidates[0];
  return first === undefined ? "곡 정보 확인 필요" : candidateName(first);
}

/**
 * Why there is nothing to hand off — in the terms of what was actually tried.
 *
 * Three different situations used to share one sentence about the caption, which was
 * wrong in two of them: the caption is not the only thing read any more, and a cover that
 * was read and found blank is a different answer from one nobody has looked at.
 */
function noCandidateReason(item: MusicItemCardModel): string {
  if (item.coverCheckedAt === null) {
    return "아직 곡을 찾지 못했어요. 릴스를 열어 직접 확인해 주세요.";
  }
  if (item.coverText === null) {
    return "표지에 글자가 없고 오디오 정보도 없어요. 릴스를 열어 직접 확인해 주세요.";
  }
  return "표지에서 글자는 읽었지만 곡 이름 형태는 아니었어요. 아래 원문을 확인해 주세요.";
}

/**
 * Everything the recogniser read off the cover, verbatim.
 *
 * Shown even when no candidate came out of it: measured over the twenty Reels with no
 * audio attribution, twelve covers carry text but only four name a track. For the other
 * eight this is the whole benefit — the playlist's own title and genre, without opening
 * the Reel.
 *
 * Always presented as *what was read*, never as what is on the image. The recogniser
 * demonstrably misreads, and the user is the one who can tell.
 */
function CoverText({ item }: { readonly item: MusicItemCardModel }) {
  if (item.coverText === null) return null;
  return (
    <details className={styles.coverText}>
      <summary className={cx(styles.coverSummary, "type-body-small")}>
        <ScanText size={13} strokeWidth={1.75} aria-hidden="true" />
        표지에서 읽은 글자
      </summary>
      <p className={cx(styles.coverBody, "type-body-small")}>{item.coverText}</p>
    </details>
  );
}

/** `8. 9.` — the footer's right-hand slot, stable between server and client. */
const SHORT_DATE = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  month: "numeric",
  day: "numeric",
});

/**
 * The expanded music review card.
 *
 * A music item can carry up to five candidate songs, each with a match grade and its own
 * hand-off link. The current Music and mixed Library boards use `MusicShelfCard` and put
 * the same list behind an in-place liner-note disclosure; this expanded form remains
 * useful where the whole review needs to stay visible at once.
 */
export function MusicItemCard({
  item,
  index = 0,
  board,
  returnHref,
}: {
  readonly item: MusicItemCardModel;
  readonly index?: number;
  /**
   * The board the page is showing.
   *
   * Wired here rather than through `BrowseCard` because this card does not use it — a music
   * row is a wide card with a candidate list and has its own markup. What it shares is the
   * `.foot`, and unlike `BrowseCard`'s that one is never hidden, so the picker sits in it
   * beside the status pill rather than above it.
   */
  readonly board?: ItemBoard;
  readonly returnHref?: string;
}) {
  const headingId = `music-${item.id}`;
  const status = collectionStatus(item.coverCheckedAt);
  // The same string the heading shows, so the picker's accessible name identifies the card
  // it belongs to rather than being the seventy-sixth control called "보드".
  const title = item.collectionName ?? item.source.label;

  return (
    <article
      className={styles.card}
      /* Capped for the same reason `BrowseCard` caps it: 65ms per step over a long board
         is a reveal nobody can read through. */
      style={{ ["--i" as string]: Math.min(index, 11) }}
      aria-labelledby={headingId}
    >
      <div className={cx(styles.inner, item.media !== null && styles.withMedia)}>
        {item.media === null ? null : (
          <div className={styles.cover}>
            {/* Local media cache; Phase 2 owns the sizing pipeline. */}
            <CollectedImage src={item.media.src} alt={item.media.alt} />
            <SourceBadge
              source={item.source}
              openLabel="원본 릴스 보기"
              className={styles.badgeFloating}
            />
          </div>
        )}

        <div className={styles.body}>
          <p className={styles.typeRow}>
            <span lang="en">Music</span>
            {item.media === null ? (
              <SourceBadge
                source={item.source}
                openLabel="원본 릴스 보기"
                className={styles.badgeInline}
              />
            ) : null}
          </p>

          <h3 id={headingId} className={cx(styles.title, "type-card-title", "clamp-2")}>
            <Link
              className={styles.titleLink}
              href={toUrlObject(itemDetailHref(item.id, returnHref))}
              scroll={false}
            >
              {title}
            </Link>
          </h3>

          <p className={cx(styles.caption, "type-body-small")}>{item.caption}</p>

          {item.candidates.length === 0 ? (
            <div className={cx(styles.noCandidates, "type-body-small")}>
              <span>{noCandidateReason(item)}</span>
              <a
                className={styles.searchLink}
                href={item.source.originalUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ justifySelf: "start" }}
              >
                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                릴스 열기
                <span className="visually-hidden">(새 탭에서 열림)</span>
              </a>
            </div>
          ) : (
            <ul className={styles.candidates} aria-label="추천된 곡">
              {item.candidates.map((candidate) => (
                <CandidateRow key={candidate.id} candidate={candidate} />
              ))}
            </ul>
          )}

          <CoverText item={item} />
          <OutboundLinks links={item.links} />

          {/* `.browse-card-foot` — the pill on the left, the meta on the right. What sat
              here in the reference ("Ready · Local", "Cross-platform") described features
              that were removed; this says whether a recogniser has read the cover yet and
              when the Reel was first seen. */}
          <div className={styles.foot}>
            {board === undefined ? null : (
              <BoardPicker itemId={item.id} board={board} itemTitle={title} compact />
            )}
            <span className={styles.footStatus}>
              <StatusPill tone={status.tone} ariaLabel={status.ariaLabel}>
                {status.label}
              </StatusPill>
            </span>
            <time
              className={styles.footMeta}
              dateTime={item.source.firstSeenAt}
              title={`${formatDateTime(item.source.firstSeenAt)}에 처음 수집`}
            >
              {SHORT_DATE.format(new Date(item.source.firstSeenAt))}
            </time>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * One square on `/music`: a record sleeve first, the complete review card on demand.
 *
 * The disclosure is important. Compressing five candidates into the sleeve would either
 * clip information or make every title unreadably small; removing them would turn a visual
 * redesign into a feature regression. Opening the count covers the same square with a
 * scrollable liner-note panel, so every grade and YouTube Music hand-off remains available
 * without changing the grid's rhythm.
 */
export function MusicShelfCard({
  item,
  index = 0,
  returnHref,
}: {
  readonly item: MusicItemCardModel;
  readonly index?: number;
  readonly returnHref?: string;
}) {
  const headingId = `music-shelf-${item.id}`;
  const title = shelfTitle(item);
  const status = collectionStatus(item.coverCheckedAt);
  const count = item.candidates.length;

  return (
    <article
      className={styles.shelfCard}
      style={{ ["--i" as string]: Math.min(index, 11) }}
      aria-labelledby={headingId}
    >
      <div className={styles.shelfCover}>
        {item.media === null ? (
          <div className={styles.shelfFallback} role="img" aria-label="저장한 릴스 표지 없음">
            <Disc3 size={48} strokeWidth={1.2} aria-hidden="true" />
            <span lang="en">Taste Inbox</span>
          </div>
        ) : (
          <CollectedImage className={styles.shelfImage} src={item.media.src} alt={item.media.alt} />
        )}
      </div>
      <div className={styles.shelfShade} aria-hidden="true" />

      <div className={styles.shelfTop}>
        <SourceBadge source={item.source} openLabel="원본 릴스 보기" />
      </div>

      <div className={styles.shelfMeta}>
        <p className={styles.shelfKicker} lang="en">
          Music · {count === 0 ? "Unidentified" : `${String(count)} track${count === 1 ? "" : "s"}`}
        </p>
        <h3 id={headingId} className={cx(styles.shelfTitle, "type-card-title", "clamp-2")}>
          <Link
            className={styles.shelfTitleLink}
            href={toUrlObject(itemDetailHref(item.id, returnHref))}
            scroll={false}
          >
            {title}
          </Link>
        </h3>
        <p className={cx(styles.shelfCaption, "type-body-small", "clamp-2")}>{item.caption}</p>
      </div>

      <details className={styles.shelfDetails}>
        <summary className={styles.shelfSummary}>
          <ListMusic className={styles.summaryClosedIcon} size={14} aria-hidden="true" />
          <X className={styles.summaryOpenIcon} size={14} aria-hidden="true" />
          <span className={styles.summaryClosedText}>
            {count === 0 ? "확인 필요" : `${String(count)}곡`}
          </span>
          <span className={cx(styles.summaryClosedText, "visually-hidden")}>
            {count === 0 ? "곡 정보 확인하기" : "추천곡 보기"}
          </span>
          <span className={styles.summaryOpenText}>목록 닫기</span>
        </summary>

        <div className={styles.shelfDrawer}>
          <p className={styles.drawerEyebrow} lang="en">
            Liner notes
          </p>
          <h4 className={styles.drawerTitle}>{title}</h4>

          {count === 0 ? (
            <div className={cx(styles.noCandidates, "type-body-small")}>
              <span>{noCandidateReason(item)}</span>
              <a
                className={styles.searchLink}
                href={item.source.originalUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                릴스 열기
                <span className="visually-hidden">(새 탭에서 열림)</span>
              </a>
            </div>
          ) : (
            <ul className={styles.candidates} aria-label="추천된 곡">
              {item.candidates.map((candidate) => (
                <CandidateRow key={candidate.id} candidate={candidate} />
              ))}
            </ul>
          )}

          <CoverText item={item} />
          <OutboundLinks links={item.links} />
          <div className={styles.drawerFoot}>
            <StatusPill tone={status.tone} ariaLabel={status.ariaLabel}>
              {status.label}
            </StatusPill>
            <time
              dateTime={item.source.firstSeenAt}
              title={`${formatDateTime(item.source.firstSeenAt)}에 처음 수집`}
            >
              {SHORT_DATE.format(new Date(item.source.firstSeenAt))}
            </time>
          </div>
        </div>
      </details>
    </article>
  );
}
