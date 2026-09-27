import { z } from "zod";
import { IsoDateTimeSchema } from "../host/host-profile";
import { EvidenceRefSchema } from "./evidence";
import { MediaRefSchema, SourceRefSchema } from "./common";
import { OutboundLinkSchema } from "./links";

/**
 * Music domain — a Reel whose *content recommends songs*.
 *
 * The signal is the post's intent, not its background audio: almost every Reel carries an
 * audio attribution, so audio presence says nothing. Identification is a fact rather than
 * an inference, because the user saves these into a named Instagram Saved collection
 * (recorded 2026-08-08 in docs/DECISIONS.md).
 *
 * Two properties shape this model:
 *
 * 1. **One Reel, many songs.** A "여름밤 노래 5곡" Reel yields five candidates. The
 *    reviewable unit is therefore `MusicTrackCandidate`, not the card. A 1:1 model would
 *    silently drop most of the recommendations in exactly the genre this exists for.
 * 2. **The card is useful even with zero candidates.** If the list is only spoken or only
 *    on screen, extraction finds nothing — and the card still shows the caption and the
 *    Reel, which is enough to stop forgetting. Nothing here treats an empty `candidates`
 *    array as a failure.
 */

/** Where a candidate's text was observed. Determines what extraction it needed. */
export const MusicAttributionOriginSchema = z.enum([
  /** Written in the post caption — deterministic text extraction, no model. */
  "caption",
  /** Rendered in the video frames — needs OCR, which is a separate, flagged capability. */
  "on_screen_text",
  /** Instagram's own audio attribution for the Reel. Rarely the recommendation itself. */
  "platform_audio",
  /** The user typed or corrected it. */
  "manual",
]);

/**
 * How confidently a raw string was resolved to a specific track.
 *
 * Mirrors `StyleMatchGrade` deliberately — the two domains have the same trust problem,
 * and reusing the shape means the same UI grammar applies.
 *
 * `different_version` exists because it is the dominant real case and has no honest home
 * in the Style grades: a sped-up or nightcore edit is a *separate commercial recording*
 * with its own ISRC, so "the same song, sped up" has two defensible correct answers.
 * Collapsing it into `exact` would silently save the wrong recording.
 */
export const MusicMatchGradeSchema = z.enum([
  "exact",
  "likely",
  "different_version",
  "similar",
  "unknown",
]);

/**
 * Where a candidate is handed off to. Not a `SourcePlatform`.
 *
 * One member, deliberately. The schema carried `spotify` and `apple_music` for a while,
 * and nothing ever emitted them — but the card's link label was a fixed string, so the
 * first producer to emit one would have rendered "YouTube Music에서 찾기" over a
 * `open.spotify.com` href. A one-member union makes that unrepresentable instead of
 * merely unlikely, and the user has said YouTube Music is the only service they use
 * (docs/DECISIONS.md, 2026-08-08). Adding a service back means adding its label at the
 * same time, which is the point.
 */
export const MusicServiceSchema = z.enum(["youtube_music"]);

export const MusicTrackCandidateSchema = z.object({
  id: z.string().min(1),
  /**
   * The observed text, verbatim and never normalised.
   *
   * Always rendered next to any inferred track: DESIGN.md §3.5 requires the fact and the
   * inference to be distinguishable, and this is the fact.
   */
  rawText: z.string().min(1),
  origin: MusicAttributionOriginSchema,
  /** Position within the Reel's list, when it is a numbered list. */
  ordinal: z.number().int().positive().nullable(),

  /** Resolved identity. Null until the enricher runs, and null is a normal state. */
  artist: z.string().nullable(),
  title: z.string().nullable(),
  album: z.string().nullable(),
  matchGrade: MusicMatchGradeSchema,
  confidence: z.number().min(0).max(1).nullable(),
  /** What the grade is based on — required for anything above `unknown`. */
  evidence: z.array(EvidenceRefSchema),

  /**
   * Prefilled search URL for the destination service.
   *
   * A hand-off, not a write: structurally the same as the Style board's retailer link.
   * Present even when the track is unresolved, built from `rawText`, because a search the
   * user finishes themselves is still far better than retyping it.
   */
  searchUrl: z.url(),
  service: MusicServiceSchema,

  /**
   * Marked by the user once they have dealt with it. The product never sets this from an
   * external write — there is no write (docs/DECISIONS.md, 2026-08-08).
   */
  handledAt: IsoDateTimeSchema.nullable(),
  checkedAt: IsoDateTimeSchema.nullable(),
});

export const MusicItemCardModelSchema = z.object({
  id: z.string().min(1),
  source: SourceRefSchema,
  /** The collection the user saved it into — the fact that makes this a music item. */
  collectionName: z.string().nullable(),
  /** Caption verbatim. Untrusted text: rendered, never executed, never used as a command. */
  caption: z.string(),
  media: MediaRefSchema.nullable(),
  /** May be empty. An empty list is a normal, useful state, not an error. */
  candidates: z.array(MusicTrackCandidateSchema),
  /**
   * Everything read off the cover image, verbatim, whether or not any of it is a track.
   *
   * Measured over the twenty Reels with no audio attribution: twelve covers have printed
   * text but only four name a track outright. Without this field those other eight gain
   * nothing from OCR at all — with it, the user can see the playlist's own title and
   * genre without opening the Reel.
   *
   * Null on its own is ambiguous, which is why `coverCheckedAt` sits beside it.
   */
  coverText: z.string().nullable().default(null),
  /**
   * When a recogniser last looked at the cover. Null means none ever has.
   *
   * The pair is what makes "아직 읽지 않았어요" and "읽었지만 글자가 없어요" different
   * states rather than the same silence — the same distinction `checkedAt` draws on the
   * other two boards.
   */
  coverCheckedAt: IsoDateTimeSchema.nullable().default(null),
  /**
   * Everywhere else this Reel points, one click away.
   *
   * Distinct from a candidate's `searchUrl`: that is a search this product composed, this
   * is a URL the post actually contained.
   */
  links: z.array(OutboundLinkSchema).default([]),
  /** True once every candidate is handled, or the user dismissed the whole card. */
  handledAt: IsoDateTimeSchema.nullable(),
});

export type MusicAttributionOrigin = z.infer<typeof MusicAttributionOriginSchema>;
export type MusicMatchGrade = z.infer<typeof MusicMatchGradeSchema>;
export type MusicService = z.infer<typeof MusicServiceSchema>;
export type MusicTrackCandidate = z.infer<typeof MusicTrackCandidateSchema>;
export type MusicItemCardModel = z.infer<typeof MusicItemCardModelSchema>;

/**
 * Build a prefilled search URL.
 *
 * Deliberately a plain search rather than a resolved track id: a search the user completes
 * cannot save the wrong song, and this keeps the hand-off working for candidates the
 * enricher could not resolve at all.
 */
const SEARCH_URL: Readonly<Record<MusicService, (encoded: string) => string>> = {
  youtube_music: (encoded) => `https://music.youtube.com/search?q=${encoded}`,
};

export function buildMusicSearchUrl(query: string, service: MusicService): string {
  return SEARCH_URL[service](encodeURIComponent(query.trim()));
}
