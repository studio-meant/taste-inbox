import { z } from "zod";

/**
 * Somewhere the item points at, reachable in one click.
 *
 * Every card already links to where the item was collected from. These are the other
 * places it names — a paper's code repository and project page, a repository's homepage.
 *
 * **Nothing here was fetched for this list.** Every URL was observed during collection.
 * Rendering a card never causes a request to a third party.
 */

/**
 * What kind of destination this is — which determines how much the label may claim.
 *
 * `artifact` is the only one that asserts anything about content (a repository or a model
 * page). The rest assert only that the item mentioned the URL.
 */
export const OutboundLinkKindSchema = z.enum([
  /** A repository, model, dataset or paper page — something the Lab can act on. */
  "artifact",
  /** A plain link, observed as written. */
  "outbound",
]);

export const OutboundLinkSchema = z.object({
  id: z.string().min(1),
  url: z.url(),
  /**
   * What to show: the destination host — `arxiv.org`, `github.com`. Never a *fetched*
   * title: nothing about rendering a card is allowed to make a request.
   */
  label: z.string().min(1),
  kind: OutboundLinkKindSchema,
});

export type OutboundLinkKind = z.infer<typeof OutboundLinkKindSchema>;
export type OutboundLink = z.infer<typeof OutboundLinkSchema>;
