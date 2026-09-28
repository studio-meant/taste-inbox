import type { SourcePlatform } from "@taste-inbox/shared";

/**
 * The mark of the account an item came from.
 *
 * Drawn here rather than imported: `lucide-react` 1.29 dropped its brand icons, and the
 * only survivor of that set in the package is `at-sign`. These are the platforms this
 * product actually collects from, and nothing else is drawn — a mark for a source that has
 * never produced an item would be decoration.
 *
 * **Monochrome, in `currentColor`.** Brand colours would be hexes outside the theme
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
      <path d={path} fillRule={EVEN_ODD.has(platform) ? "evenodd" : undefined} />
    </svg>
  );
}

/**
 * Only the platforms that collect. `arxiv` and `web` are in `SourcePlatform` because the
 * schema allows them, not because anything has arrived from one — the caller falls back to
 * the plain tinted cover for those rather than showing an invented mark.
 *
 * `huggingface` joined on 2026-09-28, when its likes started arriving. Its mark is a plain
 * smiling face drawn here — a circle with the eyes and mouth cut out — rather than a copy of
 * the brand's artwork: it has to be recognisable at 18px beside the words "Hugging Face",
 * not to reproduce a logo.
 */
const MARKS: Partial<Record<SourcePlatform, string>> = {
  huggingface:
    "M12 1a11 11 0 1 0 0 22 11 11 0 1 0 0-22ZM8.4 7.6a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4Zm7.2 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4ZM6.6 13.2h10.8a5.4 5.4 0 0 1-10.8 0Z",
  github:
    "M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 5 18 5.3 18 5.3c.6 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3",
};

/** Marks drawn as a shape with holes, which only the even-odd rule cuts out. */
const EVEN_ODD: ReadonlySet<SourcePlatform> = new Set(["huggingface"]);
