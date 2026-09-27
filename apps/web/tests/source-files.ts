import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Reading the app's own source from a test, from either working directory.
 *
 * A few tests assert on source text rather than on rendered output — that a stylesheet
 * defines a reduced-motion block, that no module-level colour escaped the token set. jsdom
 * rewrites `import.meta.url` to an `http:` URL, so those tests locate files from the working
 * directory, and the working directory is not the same in both ways this suite runs:
 * `pnpm --filter @taste-inbox/web test` starts in `apps/web`, while the root `pnpm test`
 * starts at the repo root.
 *
 * Written twice already — once in `shell.test.tsx` and once in `entry.test.tsx` — and wrong
 * the second time, with every read failing as `ENOENT` under `verify:all` while passing when
 * run alone. It lives here now so there is one place to be right.
 */
const WEB_ROOT = existsSync(resolve(process.cwd(), "src/components/shell"))
  ? process.cwd()
  : resolve(process.cwd(), "apps/web");

/** An absolute path to something under `apps/web/src`. */
export function sourcePath(...segments: readonly string[]): string {
  return resolve(WEB_ROOT, "src", ...segments);
}

/** The text of a file under `apps/web/src`. */
export function readSource(...segments: readonly string[]): string {
  return readFileSync(sourcePath(...segments), "utf8");
}

/** The names in a directory under `apps/web/src`. */
export function listSource(...segments: readonly string[]): readonly string[] {
  return readdirSync(sourcePath(...segments));
}
