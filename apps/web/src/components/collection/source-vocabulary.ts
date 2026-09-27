import type { SourcePlatform, SourceRef } from "@taste-inbox/shared";

/**
 * How a collected signal is named on screen.
 *
 * One copy, because the rail and the card say the same words about the same field and the
 * two drifting apart would be invisible until someone read both. `lib/filters/facets.ts`
 * keeps its own map for the filter chips; that one is keyed by the filter's URL value and
 * belongs to the filter layer.
 */

const PLATFORM_LABEL: Readonly<Record<SourcePlatform, string>> = {
  github: "GitHub",
  huggingface: "Hugging Face",
  arxiv: "arXiv",
  threads: "Threads",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  web: "웹",
};

/**
 * The signal itself, in the platform's own vocabulary.
 *
 * `SourceRef.actionType` is the whole input to this product — CLAUDE.md §1 opens with
 * "Star · Repost · Reaction · Like · Save" — and until now it was collected and never
 * shown anywhere.
 */
const ACTION_LABEL: Readonly<Record<NonNullable<SourceRef["actionType"]>, string>> = {
  star: "스타",
  like: "좋아요",
  // Distinct from `like` on purpose: an upvote is the user acting on the *paper*, while a
  // paper reached through a liked model's arXiv tag carries `like` because nobody upvoted
  // it. Printing one word for both would erase the difference the collectors keep.
  upvote: "업보트",
  save: "저장",
  repost: "리포스트",
};

export function platformLabel(platform: SourcePlatform): string {
  return PLATFORM_LABEL[platform];
}

/** `Instagram 저장`, `GitHub 스타`. The platform alone when the action was not recorded. */
export function sourceBadgeText(source: SourceRef): string {
  const platform = PLATFORM_LABEL[source.platform];
  const action = source.actionType == null ? null : ACTION_LABEL[source.actionType];
  return action === null ? platform : `${platform} ${action}`;
}
