import {
  AIItemKindSchema,
  DEFAULT_DENSITY,
  DEFAULT_SORT,
  DensitySchema,
  SortOrderSchema,
  SourcePlatformSchema,
  parseMultiValue,
  serializeMultiValue,
  type Density,
  type SortOrder,
} from "@taste-inbox/shared";
import { isDayKey, isMonthKey } from "./collected-days";

/**
 * The URL is the source of truth for filter, sort and density (CLAUDE.md §6).
 *
 * Everything here is pure and runs on the server: a board page reads `searchParams`,
 * parses it once, and passes the result to the repository. No component reads the URL
 * for itself, so there is exactly one place where a query string becomes a query.
 *
 * **Nothing personal is ever encoded here.** These URLs get bookmarked and shared, and
 * every value below is an enum literal from the shared schemas — never a caption, a
 * handle, or an item id.
 *
 * Parsing never throws. A URL someone saved before an enum changed still opens the board,
 * just without the filter that no longer exists; `unknownKeys` records what was dropped so
 * the page can say so rather than silently ignoring the user's link.
 */

/** What a board page receives from Next.js. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The day an item was collected, as a URL key — `?day=2026-08-08`.
 *
 * A local calendar day in `APP_TIME_ZONE`, never a UTC date (`lib/filters/collected-days`).
 * Single-valued: the rail's calendar selects one day and clicking it again clears it, the
 * same grammar the rail's source rows use.
 *
 * Not personal data, and worth saying out loud given the docstring above: this is a date,
 * the same one already printed on every card, not an item id or a handle.
 */
export const DAY_KEY = "day";

/**
 * Which month the rail's calendar is showing — `?cal=2026-08`.
 *
 * View state, like `sort` and `density`: it changes what the calendar draws and never what
 * the board contains. It exists so the calendar can be one month with links to the
 * previous and next month *that have items*, instead of a stack of one grid per month —
 * which is fine at two months and is a metre of dead grid after a year of collecting.
 */
export const CALENDAR_MONTH_KEY = "cal";

/**
 * Every key a board URL is allowed to carry.
 *
 * The complete list, deliberately in one place: anything absent from it is dropped when a
 * link is rebuilt, so an unexpected key cannot ride along through a filter change.
 */
export const BOARD_URL_KEYS = [
  "kind",
  "source",
  DAY_KEY,
  CALENDAR_MONTH_KEY,
  "handled",
  "sort",
  "density",
] as const;

/** Browse routes that may be carried through an item detail URL. */
const BOARD_RETURN_PATHS = new Set(["/library", "/trends", "/style", "/music", "/places", "/none"]);

function validReturnValue(name: (typeof BOARD_URL_KEYS)[number], value: string): boolean {
  const everyValueIs = (options: readonly string[]) =>
    value.split(",").every((entry) => entry !== "" && options.includes(entry));
  switch (name) {
    case "kind":
      return everyValueIs(AIItemKindSchema.options);
    case "source":
      return everyValueIs(SourcePlatformSchema.options);
    case DAY_KEY:
      return isDayKey(value);
    case CALENDAR_MONTH_KEY:
      return isMonthKey(value);
    case "handled":
      return value === "shown";
    case "sort":
      return SortOrderSchema.safeParse(value).success;
    case "density":
      return DensitySchema.safeParse(value).success;
  }
}

function appendBoardState(
  next: URLSearchParams,
  name: (typeof BOARD_URL_KEYS)[number],
  value: string | null,
) {
  if (value !== null && value !== "" && validReturnValue(name, value)) next.set(name, value);
}

export interface BoardView {
  readonly sort: SortOrder;
  readonly density: Density;
}

/** The one facet every board shares with the rail's calendar. `null` is "every day". */
interface DayFilter {
  readonly day: string | null;
}

export interface AIBoardFilters extends BoardView, DayFilter {
  readonly kind: readonly (typeof AIItemKindSchema)["options"][number][];
  readonly source: readonly (typeof SourcePlatformSchema)["options"][number][];
}

export interface StyleBoardFilters extends BoardView, DayFilter {
  readonly source: readonly (typeof SourcePlatformSchema)["options"][number][];
}

export interface MusicBoardFilters extends DayFilter {
  /** The board is an inbox: cleared rows are hidden unless asked for. */
  readonly handled: "hidden" | "shown";
}

/**
 * A repeated key (`?kind=a&kind=b`) is not the grammar — multi-value is
 * comma-separated on one key. Taking the first entry keeps a hand-edited URL working
 * rather than failing on it.
 */
export function firstValue(raw: string | string[] | undefined): string | null {
  return first(raw);
}

function first(raw: string | string[] | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function readView(params: RawSearchParams): BoardView {
  return {
    sort: SortOrderSchema.catch(DEFAULT_SORT).parse(first(params.sort)),
    density: DensitySchema.catch(DEFAULT_DENSITY).parse(first(params.density)),
  };
}

/**
 * The selected day, or `null`.
 *
 * A value that is not a real calendar date is dropped rather than passed on, exactly as an
 * unknown enum literal is — `unknownFilterValues` reports it, and the board opens instead
 * of failing on a hand-edited or stale link.
 */
export function parseDay(params: RawSearchParams): string | null {
  const raw = first(params[DAY_KEY]);
  return raw !== null && isDayKey(raw) ? raw : null;
}

/** Which month the calendar should draw, if the URL asked for one. View state, not a filter. */
export function parseCalendarMonth(params: RawSearchParams): string | null {
  const raw = first(params[CALENDAR_MONTH_KEY]);
  return raw !== null && isMonthKey(raw) ? raw : null;
}

export function parseAIFilters(params: RawSearchParams): AIBoardFilters {
  return {
    ...readView(params),
    kind: parseMultiValue(first(params.kind), AIItemKindSchema),
    source: parseMultiValue(first(params.source), SourcePlatformSchema),
    day: parseDay(params),
  };
}

export function parseStyleFilters(params: RawSearchParams): StyleBoardFilters {
  return {
    ...readView(params),
    source: parseMultiValue(first(params.source), SourcePlatformSchema),
    day: parseDay(params),
  };
}

export function parseMusicFilters(params: RawSearchParams): MusicBoardFilters {
  return {
    handled: first(params.handled) === "shown" ? "shown" : "hidden",
    day: parseDay(params),
  };
}

/**
 * The Inbox — the merged board.
 *
 * It carries `source` unconditionally, because that is the only field an AI post, a fashion
 * carousel and a saved Reel all answer. `kind` is conditional, and the condition is the
 * board's own contents rather than a setting: a merged board offering a facet that exists
 * on one of its three models would filter one list and silently pass the other two
 * through — which is the failure docs/DECISIONS.md (2026-08-08) calls worse than not
 * offering the filter at all.
 *
 * `withKind` is that condition, and the caller decides it by looking: when nothing on the
 * board is a Style or Music row, every entry carries `kind` and the facet is honest. In the
 * `rnd` edition that is every render — the browser collectors that fill those boards do not
 * run — and in the personal workspace it is whichever days nothing was saved from
 * Instagram. Either way it is read from the items, not declared.
 */
export function parseLibraryFilters(
  params: RawSearchParams,
  { withKind = false }: { readonly withKind?: boolean } = {},
): AIBoardFilters | StyleBoardFilters {
  return withKind ? parseAIFilters(params) : parseStyleFilters(params);
}

/** True when the board is showing everything it has. */
export function isUnfiltered(filters: AIBoardFilters | StyleBoardFilters): boolean {
  const groups = "kind" in filters ? [filters.kind, filters.source] : [filters.source];
  return filters.day === null && groups.every((group) => group.length === 0);
}

export function activeFilterCount(filters: AIBoardFilters | StyleBoardFilters): number {
  const groups = "kind" in filters ? [filters.kind, filters.source] : [filters.source];
  const values = groups.reduce((total, group) => total + group.length, 0);
  return values + (filters.day === null ? 0 : 1);
}

/**
 * Build the href for toggling one value in one group.
 *
 * Returns a full query string rather than mutating anything, so the caller can render it
 * as a plain `<a href>`. That matters more than it looks: a filter chip that is a real
 * link works before hydration, opens in a new tab, and shows its destination on hover —
 * none of which a click handler gives you.
 *
 * Sort and density survive a filter toggle; a key at its default is dropped so the
 * canonical URL of an unfiltered board is bare.
 */
export function toggleFilterHref(
  pathname: string,
  params: RawSearchParams,
  key: string,
  value: string,
  /**
   * `"single"` replaces the group's selection instead of adding to it.
   *
   * The rail's source rows read as a list of places to go — the same shape, in the same
   * panel, as "Browse by type" directly above them, where one click means *show me this
   * one*. Accumulating there meant clicking GitHub and then Instagram showed both, which
   * is not what the row looks like it promises. Clicking the row that is already on still
   * clears it — and since the "필터 지우기" control was removed (2026-08-10) that
   * re-click, together with the chip that toggles itself off, is how a person gets back to
   * the whole board. The rail's calendar uses the same mode for the same reason.
   *
   * The chips keep `"multi"`: they are laid out as a set of independent switches and read
   * that way. Each one still removes exactly its own value on a second click, so a
   * multi-value selection unwinds one chip at a time.
   */
  mode: "multi" | "single" = "multi",
): string {
  const next = new URLSearchParams();

  // An allowlist, not a copy. Carrying unknown keys through would mean a URL that
  // somehow picked up a caption or a handle keeps propagating it every time the user
  // touches a filter — and this function is the one place that decides what a shared
  // board link contains.
  for (const name of BOARD_URL_KEYS) {
    const single = first(params[name]);
    if (single !== null && single !== "" && name !== key) {
      next.set(name, single);
    }
  }

  const current = (first(params[key]) ?? "").split(",").filter((entry) => entry !== "");
  const without = current.filter((entry) => entry !== value);
  const isOn = without.length !== current.length;
  const selected =
    mode === "single"
      ? // On → off clears the group; anything else becomes exactly this one, discarding
        // whatever else was selected — including a multi-value selection arrived at from a
        // shared link, which is the honest reading of "show me this one".
        isOn
        ? []
        : [value]
      : isOn
        ? without
        : [...current, value];

  const serialized = serializeMultiValue(selected);
  if (serialized !== null) {
    next.set(key, serialized);
  }

  // Defaults are implied, so they never appear in a shared link.
  if (next.get("sort") === DEFAULT_SORT) {
    next.delete("sort");
  }
  if (next.get("density") === DEFAULT_DENSITY) {
    next.delete("density");
  }

  const query = next.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

/**
 * The href that clears every filter but keeps how the user is viewing the board.
 *
 * **No longer a control of its own.** The "필터 지우기" row in the rail and the
 * "필터 N개 지우기" chip were removed on 2026-08-10: every filter the product offers now
 * clears itself on a second click, and a standing undo button beside controls that already
 * undo themselves is a second way to say the same thing. Two callers remain, and both are
 * a sentence rather than a button — `NoMatches`, where the board is empty and there is
 * nothing left to click off, and `FilterSheet`, which builds its batch from a clean slate.
 *
 * `cal` goes with the filters rather than with `sort`/`density`: it is the calendar's view
 * of a filter that is being cleared, so keeping it would leave the rail pointing at a month
 * the person is no longer looking at.
 */
export function clearFiltersHref(pathname: string, params: RawSearchParams): string {
  const next = new URLSearchParams();
  for (const name of ["sort", "density"] as const) {
    const value = first(params[name]);
    const isDefault = name === "sort" ? value === DEFAULT_SORT : value === DEFAULT_DENSITY;
    if (value !== null && value !== "" && !isDefault) {
      next.set(name, value);
    }
  }
  const query = next.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

/** Rebuild the current board URL from the same allowlist used by filter controls. */
export function boardViewHref(pathname: string, params: RawSearchParams): string {
  const next = new URLSearchParams();
  for (const name of BOARD_URL_KEYS) {
    appendBoardState(next, name, first(params[name]));
  }
  const query = next.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}

/** Link to a detail while remembering the exact filtered board it came from. */
export function itemDetailHref(id: string, returnTo?: string): string {
  const pathname = `/items/${encodeURIComponent(id)}`;
  if (returnTo === undefined) return pathname;
  const query = new URLSearchParams({ from: returnTo });
  return `${pathname}?${query.toString()}`;
}

/**
 * Accept only a known local board and known filter keys from a detail URL.
 *
 * `from` is navigation state, not an open redirect: schemes, hosts, hashes, unknown routes
 * and unexpected query keys are discarded before the back link is rendered.
 */
export function safeBoardReturnHref(raw: string | null, fallback: string): string {
  if (raw === null || raw.includes("#")) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://taste-inbox.local");
  } catch {
    return fallback;
  }
  if (parsed.origin !== "https://taste-inbox.local" || !BOARD_RETURN_PATHS.has(parsed.pathname)) {
    return fallback;
  }

  const next = new URLSearchParams();
  for (const name of BOARD_URL_KEYS) {
    appendBoardState(next, name, parsed.searchParams.get(name));
  }
  const query = next.toString();
  return query === "" ? parsed.pathname : `${parsed.pathname}?${query}`;
}

/**
 * Filter values present in the URL that no schema recognises.
 *
 * Surfaced rather than swallowed: a stale bookmark that quietly shows an unfiltered board
 * looks like the filter matched everything, which is a different and wrong answer.
 */
export function unknownFilterValues(params: RawSearchParams): readonly string[] {
  const known: Record<string, readonly string[]> = {
    kind: AIItemKindSchema.options,
    source: SourcePlatformSchema.options,
    sort: SortOrderSchema.options,
    density: DensitySchema.options,
  };

  const dropped: string[] = [];

  // `day` has no enum to check against — any real calendar date is a legal value, and only
  // a malformed one is droppable. Reported through the same channel so a link carrying
  // `?day=2026-13-40` says so rather than quietly opening an unfiltered board.
  const rawDay = first(params[DAY_KEY]);
  if (rawDay !== null && rawDay !== "" && !isDayKey(rawDay)) {
    dropped.push(`${DAY_KEY}=${rawDay}`);
  }

  for (const [key, options] of Object.entries(known)) {
    const raw = first(params[key]);
    if (raw === null || raw === "") {
      continue;
    }
    for (const value of raw.split(",")) {
      const trimmed = value.trim();
      if (trimmed !== "" && !options.includes(trimmed)) {
        dropped.push(`${key}=${trimmed}`);
      }
    }
  }
  return dropped;
}

/**
 * Adapt a built href for `next/link`.
 *
 * Typed routes reject an arbitrary string, and casting one through would give up the
 * check that catches a mistyped route. A `UrlObject` keeps the check on the path while
 * letting the query stay dynamic, which is exactly the split that is true here: the path
 * is a known route, the query is user state.
 */
export function toUrlObject(href: string): { pathname: string; query?: string } {
  const [pathname = href, query] = href.split("?");
  return query === undefined ? { pathname } : { pathname, query };
}
