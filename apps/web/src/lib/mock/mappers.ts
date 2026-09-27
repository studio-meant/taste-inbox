import {
  buildMusicSearchUrl,
  captionBodyOf,
  hashtagsOf,
  isReel,
  permalinkOf,
  type AIItemCardModel,
  type CollectedItem,
  type MediaRef,
  type MusicItemCardModel,
  type SourceRef,
  type StyleItemCardModel,
} from "@taste-inbox/shared";

/**
 * Collected item → domain view model.
 *
 * One rule governs every mapper here: **an unenriched item must not look enriched.**
 * None of this data has been through an enricher, so there is no product identity, no
 * track and no price. Every such field maps to `null` or `unknown` rather than to a
 * plausible guess (`DESIGN.md` §3.5, and the 2026-08-08 amendment in
 * `docs/DECISIONS.md`).
 *
 * What *is* real: the source, the permalink, the caption, the thumbnail, and when we
 * first saw it. The boards are built on those.
 */

/** Instagram does not expose when a like or save happened, only when the post was made. */
function firstSeenAt(item: CollectedItem): string {
  return item.taken_at === null
    ? new Date(0).toISOString()
    : new Date(item.taken_at * 1000).toISOString();
}

function sourceOf(item: CollectedItem, label: string): SourceRef {
  return {
    platform: "instagram",
    label,
    originalUrl: permalinkOf(item),
    author: item.owner,
    actionType: "save",
    firstSeenAt: firstSeenAt(item),
  };
}

function mediaOf(item: CollectedItem): MediaRef | null {
  if (item.thumbnail_url === null) {
    return null;
  }
  return {
    id: `${item.code}-thumb`,
    type: isReel(item) ? "video_frame" : "image",
    src: item.thumbnail_url,
    width: item.thumbnail_width,
    height: item.thumbnail_height,
    // Instagram's own alt when present; otherwise describe what the tile actually is,
    // rather than inventing a description of an image we have not looked at.
    alt:
      item.accessibility_caption ??
      (isReel(item) ? "저장한 릴스의 표지 이미지" : "저장한 게시물의 이미지"),
    blurDataUrl: null,
  };
}

/** First non-empty line, which is where a Korean caption usually puts its point. */
function headlineOf(item: CollectedItem, fallback: string): string {
  const body = captionBodyOf(item);
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line && line.length > 0 ? line.slice(0, 80) : fallback;
}

/**
 * A saved fashion post: every photo it contained, its caption, and where it points.
 *
 * Nothing here resolves a product, and nothing ever will — that decision removed `brand`,
 * `productName`, `matchGrade`, `currentPrice`, `observedPrice`, `retailerCount` and
 * `stockState` from the model, exactly as the sandbox runner's removal took the AI card's
 * execution fields (docs/DECISIONS.md, 2026-08-09). Mapping them to null was the honest
 * choice while a resolver was still coming; with none coming, the fields only reserved
 * space for a question nobody will answer.
 */
export function toStyleCard(item: CollectedItem): StyleItemCardModel {
  const cover = mediaOf(item);
  return {
    id: item.code,
    source: sourceOf(item, "Instagram Saved · Fashion"),
    // The fixture format carries one image per item: it predates the collector reading
    // past `carousel_media`, so a re-collection is what fills this array, not a change
    // here. One entry and five entries render the same way.
    media: cover === null ? [] : [cover],
    descriptor: headlineOf(item, "저장한 패션 게시물"),
    // Whole, hashtags included, like the live path. The card clamps and can un-clamp.
    caption: item.caption,
    checkedAt: null,
    tags: tagsOf(item),
    // The fixture format carries no extracted links; the live path builds these from
    // stored evidence. Empty is the honest value, not a placeholder.
    links: [],
    // Nor a profile: reading one is a separate pass over the accounts, and the fixtures
    // predate it. Null says nobody looked, which is true here.
    author: null,
  };
}

export function toAICard(item: CollectedItem): AIItemCardModel {
  return {
    id: item.code,
    // An Instagram post is not a repo, model or paper. It is a post, and saying so is
    // what keeps the card out of the artefact vocabulary.
    kind: "post",
    title: headlineOf(item, "저장한 AI 게시물"),
    source: sourceOf(item, "Instagram Saved · AI"),
    // Whole, like the live path. The card clamps and can un-clamp; a slice cannot.
    summary: captionBodyOf(item),
    // Never checked, and it says so rather than implying an answer is coming.
    checkedAt: null,
    tags: tagsOf(item),
    links: [],
    preview: mediaOf(item),
  };
}

/**
 * Does the Reel itself corroborate the audio Instagram attached to it?
 *
 * On a recommendation Reel the attached audio is usually the song being recommended, but
 * "usually" is not a grade. This looks for a second, independent statement of the same
 * artist or title — in the caption the account wrote, or in the account's own handle.
 * Two sources agreeing is what separates `exact` from `likely` (DESIGN.md §3.5).
 *
 * Matching is deliberately loose about punctuation and credit formatting: "수민, Slom"
 * corroborates against a caption that writes "slom", and an artist posting under their own
 * name ("homezone") corroborates against `@whereisyourhomezone`. It stays strict about
 * length, so a two-character fragment cannot match by accident.
 */
function audioIsCorroborated(item: CollectedItem): boolean {
  const haystack = normalizeForMatch(`${item.caption} ${item.owner ?? ""}`);
  const parts = [item.audio_artist, item.audio_title]
    .filter((value): value is string => value !== null && value.length > 0)
    .flatMap((value) => value.split(/[,&/]|\sfeat\.?\s|\swith\s/i));

  return parts.some((part) => {
    const needle = normalizeForMatch(part);
    return needle.length >= 3 && haystack.includes(needle);
  });
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

export function toMusicCard(item: CollectedItem): MusicItemCardModel {
  // Song lists are rarely written in the caption — they are on screen or spoken — so no
  // extraction is attempted here; a wrong track is worse than no track. The caption is
  // shown whole, and the audio attribution, when Instagram supplied one, becomes a single
  // candidate.
  const attributed = item.audio_title !== null || item.audio_artist !== null;
  const rawText = [item.audio_artist, item.audio_title].filter(Boolean).join(" - ");
  const corroborated = audioIsCorroborated(item);

  return {
    id: item.code,
    source: sourceOf(item, "Instagram Saved · Music"),
    collectionName: "music",
    caption: item.caption,
    media: mediaOf(item),
    candidates:
      attributed && rawText.length > 0
        ? [
            {
              id: `${item.code}-audio`,
              rawText,
              origin: "platform_audio",
              ordinal: null,
              artist: item.audio_artist,
              title: item.audio_title,
              album: null,
              // Two independent statements of the same track — the audio Instagram
              // attached, and the account's own caption or handle — is the standard for
              // `exact`. Attribution alone stays `likely`: it is a fact about the Reel's
              // audio, which on some Reels is background music rather than the pick.
              matchGrade: corroborated ? "exact" : "likely",
              confidence: null,
              evidence: [
                {
                  id: `${item.code}-audio-evidence`,
                  type: "audio_attribution",
                  label: "릴스 오디오 표기",
                  value: rawText,
                  provenance: "fact",
                  sourceUrl: permalinkOf(item),
                  observedAt: firstSeenAt(item),
                  confidence: null,
                },
                ...(corroborated
                  ? [
                      {
                        id: `${item.code}-caption-evidence`,
                        type: "caption_mention" as const,
                        label: "게시물이 같은 곡을 언급함",
                        value: rawText,
                        provenance: "fact" as const,
                        sourceUrl: permalinkOf(item),
                        observedAt: firstSeenAt(item),
                        confidence: null,
                      },
                    ]
                  : []),
              ],
              searchUrl: buildMusicSearchUrl(rawText, "youtube_music"),
              service: "youtube_music",
              handledAt: null,
              checkedAt: null,
            },
          ]
        : [],
    // The fixture format has no cover-text field, and no recogniser runs against mock
    // data. Null with a null timestamp is "nobody has looked", which is true here.
    coverText: null,
    coverCheckedAt: null,
    links: [],
    handledAt: null,
  };
}

/** Hashtags surface as evidence chips on the boards. */
export function tagsOf(item: CollectedItem): string[] {
  return hashtagsOf(item).slice(0, 6);
}
