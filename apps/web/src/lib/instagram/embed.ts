const INSTAGRAM_EMBED_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_POST_KINDS = new Set(["p", "reel", "reels", "tv"]);
const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/;

/**
 * Build Instagram's own embed endpoint from a public post permalink.
 *
 * The original permalink is the only input. In particular, this never accepts a CDN/media
 * URL and never turns `video_versions` into a first-party player. A malformed, non-Instagram,
 * profile or settings URL stays an ordinary external link instead of reaching an iframe.
 */
export function instagramEmbedUrl(originalUrl: string): string | null {
  try {
    const parsed = new URL(originalUrl);
    if (parsed.protocol !== "https:" || !INSTAGRAM_EMBED_HOSTS.has(parsed.hostname)) return null;

    const [kind, code] = parsed.pathname.split("/").filter(Boolean);
    if (kind === undefined || code === undefined || !INSTAGRAM_POST_KINDS.has(kind)) return null;
    if (!SHORTCODE.test(code)) return null;

    const canonicalKind = kind === "reels" ? "reel" : kind;
    return `https://www.instagram.com/${canonicalKind}/${encodeURIComponent(code)}/embed/`;
  } catch {
    return null;
  }
}
