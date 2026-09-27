type QueryValue = string | number | boolean | readonly string[] | null | undefined;

export interface UrlObject {
  readonly pathname?: string | null;
  /** Next's UrlObject also accepts an already-serialized query string. */
  readonly query?: string | Readonly<Record<string, QueryValue>> | null;
  readonly hash?: string | null;
}

/** Serialize the subset of Next's UrlObject used by the shared web screens. */
export function toHref(href: string | UrlObject, fallbackPathname?: string): string {
  if (typeof href === "string") return href;

  let query = "";
  if (typeof href.query === "string") {
    query = href.query.replace(/^\?/u, "");
  } else {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(href.query ?? {})) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const entry of value as readonly string[]) params.append(key, entry);
      } else {
        params.set(key, String(value));
      }
    }
    query = params.toString();
  }

  const currentPath =
    fallbackPathname ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  const hash = href.hash ?? "";
  return `${href.pathname ?? currentPath}${query === "" ? "" : `?${query}`}${hash}`;
}
