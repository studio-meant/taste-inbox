import type { SourcePlatform } from "@taste-inbox/shared";

/**
 * The mark of the account an item came from.
 *
 * Drawn here rather than imported: `lucide-react` 1.29 dropped its brand icons, and the
 * only survivor of that set in the package is `at-sign`. These are the four platforms this
 * product actually collects from, and nothing else is drawn — a mark for a source that has
 * never produced an item would be decoration.
 *
 * **Monochrome, in `currentColor`.** Brand colours would be seven hexes outside the theme
 * registry, which `DESIGN.md` §20 forbids, and they would fight a palette built out of
 * sage and cream. The card is already tinted by source (`COVER_TINT`, the same colours the
 * rail's dots use), so the hue carries the identity and the mark makes it recognisable at a
 * glance instead of asking anyone to learn a colour.
 *
 * Used as identification, and always beside the platform's name in text — the mark is never
 * the only thing saying where an item came from.
 */
export function SourceMark({
  platform,
  size = 18,
}: {
  readonly platform: SourcePlatform;
  readonly size?: number;
}) {
  const path = MARKS[platform];
  if (path === undefined) {
    return null;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Only the four that collect. `huggingface`, `arxiv` and `web` are in `SourcePlatform`
 * because the schema allows them, not because anything has arrived from one — the caller
 * falls back to the plain tinted cover for those rather than showing an invented mark.
 */
const MARKS: Partial<Record<SourcePlatform, string>> = {
  github:
    "M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 5 18 5.3 18 5.3c.6 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3",
  linkedin:
    "M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.13 1.44-2.13 2.94v5.66H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13Zm1.78 13.02H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z",
  instagram:
    "M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.9 5.9 0 0 0-2.13 1.38A5.9 5.9 0 0 0 .63 4.14c-.3.76-.5 1.64-.56 2.91C.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91a5.9 5.9 0 0 0 1.38 2.13 5.9 5.9 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a6.13 6.13 0 0 0 3.51-3.51c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.85-10.41a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z",
  threads:
    "M17.1 11.13c-.1-.05-.21-.1-.32-.14-.19-3.42-2.09-5.37-5.29-5.39h-.04c-1.91 0-3.5.8-4.48 2.26l1.76 1.2c.73-1.09 1.88-1.32 2.72-1.32h.03c1.05 0 1.85.31 2.36.9.37.42.62 1.01.75 1.75a13.85 13.85 0 0 0-3.02-.14c-3.03.17-4.98 1.94-4.85 4.4.07 1.22.68 2.27 1.75 2.96.9.58 2.06.87 3.26.8 1.59-.09 2.84-.69 3.73-1.79.66-.83 1.09-1.92 1.28-3.27.76.45 1.32 1.04 1.63 1.75.53 1.2.56 3.18-1.09 4.8-1.44 1.41-3.17 2.02-5.8 2.04-2.9-.02-5.1-.94-6.54-2.72C3.6 17.5 2.91 15.09 2.88 12c.03-3.09.72-5.5 2.06-7.16 1.43-1.78 3.63-2.7 6.54-2.72 2.93.02 5.17 .95 6.66 2.75.73.89 1.28 2 1.65 3.29l2.04-.57c-.45-1.59-1.15-2.96-2.1-4.1C17.86 1.13 15.2.02 11.5 0h-.01C7.9.02 5.15 1.2 3.3 3.5 1.66 5.56.81 8.41.78 11.99v.02c.03 3.58.88 6.43 2.52 8.48 1.85 2.3 4.6 3.49 8.19 3.51h.01c3.41-.02 5.65-.84 7.5-2.65 2.42-2.37 2.35-5.34 1.55-7.16-.57-1.31-1.66-2.37-3.15-3.07Zm-4.99 5.06c-1.33.07-2.72-.51-2.78-1.77-.05-.93.66-1.97 2.86-2.1.25-.01.5-.02.74-.02.8 0 1.55.08 2.23.23-.25 3.17-1.85 3.65-3.05 3.71Z",
};
