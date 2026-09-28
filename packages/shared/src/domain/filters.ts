import { z } from "zod";

/**
 * The URL filter vocabulary.
 *
 * The URL is the source of truth for route, filter, sort and selected item (CLAUDE.md §6),
 * so these literals are a public interface: they appear in links people bookmark and share,
 * and renaming one breaks every saved URL.
 *
 * **snake_case, and identical to the enum literals themselves.** With this rule the URL
 * value *is* the schema value, so parsing a query string is `z.enum(...).parse(raw)` and
 * nothing else. The alternative — kebab-case in the URL, snake_case in the code — needs an
 * encode/decode table at every boundary, and that table is one more thing that can drift
 * out of sync with the enums it is supposed to mirror (docs/DECISIONS.md, 2026-08-08).
 *
 * Multi-value filters are comma-separated on a single key: `?status=ready_local,blocked`.
 */

/**
 * Inbox ordering. `recent` is retired in favour of `newest`; the price orders went with the
 * Style board on 2026-09-28.
 */
export const SortOrderSchema = z.enum(["newest", "relevance"]);

/** What the Inbox does before the user has chosen. */
export const DEFAULT_SORT: SortOrder = "newest";

/**
 * Card density. Deliberately not `view`, which already selects the Library's tab
 * (`/library?view=sources`); one key cannot mean two things in one URL grammar.
 */
export const DensitySchema = z.enum(["cards", "compact"]);

export const DEFAULT_DENSITY: Density = "cards";

export type SortOrder = z.infer<typeof SortOrderSchema>;
export type Density = z.infer<typeof DensitySchema>;

/**
 * Read a comma-separated multi-value filter.
 *
 * An unrecognised value is dropped rather than throwing: a stale bookmark from before an
 * enum changed should still open the board, just without the filter it can no longer
 * apply. Order is preserved and duplicates are collapsed.
 */
export function parseMultiValue<T extends string>(
  raw: string | null | undefined,
  schema: z.ZodType<T>,
): readonly T[] {
  if (raw === null || raw === undefined || raw === "") {
    return [];
  }

  const seen = new Set<T>();
  for (const part of raw.split(",")) {
    const parsed = schema.safeParse(part.trim());
    if (parsed.success) {
      seen.add(parsed.data);
    }
  }
  return [...seen];
}

/**
 * Write a multi-value filter back to a query string value.
 *
 * Returns `null` for an empty selection so the caller can delete the key entirely — an
 * empty `?status=` is a filter that reads as active and matches nothing.
 */
export function serializeMultiValue(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join(",");
}
