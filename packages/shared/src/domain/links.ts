import { z } from "zod";

/**
 * Somewhere the item points at, reachable in one click.
 *
 * Every card already links to where the item was collected from — the Reel, the post, the
 * repository. That is the *origin*, and for a LinkedIn post whose real subject is a paper
 * on another domain it is one hop short of useful. These are the other end of that hop.
 *
 * Three rules hold this honest:
 *
 * 1. **Nothing here was fetched for this list.** Every URL was already observed during
 *    collection or already followed by the shortener resolver. Rendering a card never
 *    causes a request to a third party.
 * 2. **A shortener is not its destination.** `lnkd.in/g6kHemzF` and the page it leads to
 *    are two different facts, and `via` keeps them attached rather than replacing one with
 *    the other — the user can still see which wrapper was unwrapped.
 * 3. **An unfollowed shortener is still shown.** It is a link the user can click; hiding
 *    it because the resolver failed would remove a working affordance to protect a tidy
 *    model.
 */

/**
 * What kind of destination this is — which determines how much the label may claim.
 *
 * `artifact` is the only one that asserts anything about content (a repository or a model
 * page). The rest assert only that the item mentioned the URL.
 */
export const OutboundLinkKindSchema = z.enum([
  /** A repository or model page. The one kind the Trends board can act on. */
  "artifact",
  /**
   * A shop the author named in their own profile.
   *
   * Its own kind because it is the answer to a different question. A post link is "what is
   * this post about"; this is "where do I buy the thing" — and measured across the Style
   * board, almost no post carries a link while 51 of the 61 authors do
   * (docs/DECISIONS.md, 2026-08-09).
   */
  "shop",
  /** A shortener that was followed. `url` is the destination, `via` the wrapper. */
  "resolved",
  /** A plain link, observed as written. */
  "outbound",
  /** A shortener nobody followed. `url` is the wrapper itself, and says so. */
  "unresolved",
]);

/**
 * Where the URL was written.
 *
 * A commenter's link is not the author's claim, and neither is a bio link: the profile
 * says where this account sells, not what this particular post is about. The card labels
 * all three so a click is never mistaken for a stronger statement than it is.
 */
export const OutboundLinkOriginSchema = z.enum(["post", "comment", "profile"]);

export const OutboundLinkSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  /**
   * What to show. The destination host for a post link — `arxiv.org`, `github.com` — and
   * the author's own title for a shop, because they wrote it and it says more.
   *
   * Never a *fetched* title: nothing about rendering a card is allowed to make a request.
   * A host is derivable from the URL, and a shop's title was already read off the profile
   * that named it — both are things the product already had.
   */
  label: z.string().min(1),
  kind: OutboundLinkKindSchema,
  origin: OutboundLinkOriginSchema,
  /** The shortener that was unwrapped to get here. Null when none was involved. */
  via: z.url().nullable(),
});

export type OutboundLinkKind = z.infer<typeof OutboundLinkKindSchema>;
export type OutboundLinkOrigin = z.infer<typeof OutboundLinkOriginSchema>;
export type OutboundLink = z.infer<typeof OutboundLinkSchema>;
