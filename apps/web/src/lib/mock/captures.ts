import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CollectedItemsSchema,
  type CollectedDomain,
  type CollectedItem,
} from "@taste-inbox/shared";

/**
 * Read real collected items from the gitignored `var/` tree.
 *
 * The collections contain the user's own saved posts — third-party captions, handles,
 * signed media URLs. That is personal data, so it is never committed as a fixture and
 * never leaves `var/`. The app reads it at request time in mock mode instead, which puts
 * real content on screen without putting any of it in the repository.
 *
 * When the files are absent — a fresh checkout, or CI — the repository falls back to the
 * committed seed. Nothing here is required for the app to run.
 */

/**
 * Walk up from the working directory to the workspace root.
 *
 * `process.cwd()` is `apps/web` under `next dev` and the repo root under a workspace
 * test run; resolving a fixed relative path against it broke in whichever case it was
 * not written for.
 */
function findRepoRoot(): string | null {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

const cache = new Map<CollectedDomain, readonly CollectedItem[]>();

/**
 * Whether to read the local captures at all.
 *
 * Off under test, unconditionally. A suite whose fixtures depend on whichever
 * collections happen to sit in one developer's `var/` directory passes in CI and fails on
 * their machine — which is worse than failing in both places, because it teaches everyone
 * to distrust the suite. Tests that need capture behaviour set up their own files and opt
 * in explicitly.
 */
function capturesEnabled(): boolean {
  const explicit = process.env.TASTE_INBOX_USE_CAPTURES;
  if (explicit !== undefined) {
    return explicit !== "0" && explicit !== "false";
  }
  return process.env.NODE_ENV !== "test";
}

export function loadCollected(domain: CollectedDomain): readonly CollectedItem[] {
  if (!capturesEnabled()) {
    return [];
  }

  const cached = cache.get(domain);
  if (cached !== undefined) {
    return cached;
  }

  const dir = captureDir();
  const items = dir === null ? [] : readCaptureFile(join(dir, `saved-${domain}.json`));
  cache.set(domain, items);
  return items;
}

/**
 * Where the capture files live.
 *
 * `TASTE_INBOX_CAPTURE_DIR` overrides the default so tests can point at a temporary
 * directory. Without it a test exercising this loader would have to write into the real
 * `var/captures/`, overwriting collections that took a live browser session to gather.
 */
function captureDir(): string | null {
  const override = process.env.TASTE_INBOX_CAPTURE_DIR;
  if (override !== undefined && override !== "") {
    return override;
  }
  const root = findRepoRoot();
  // Spelled out rather than spread from an array: a spread defeats the bundler's static
  // analysis, and it then traces the entire project into the server output rather than
  // one known subfolder.
  return root === null ? null : join(root, "var", "captures");
}

function readCaptureFile(path: string): readonly CollectedItem[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = CollectedItemsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      // A malformed capture must not take the app down. Falling back to the seed keeps
      // the screen usable and the failure visible in `hasCollected`.
      console.warn(`[captures] ${path} did not match the collected-item schema; ignoring.`);
      return [];
    }
    return parsed.data;
  } catch (error) {
    console.warn(`[captures] could not read ${path}:`, error);
    return [];
  }
}

export function hasCollected(domain: CollectedDomain): boolean {
  return loadCollected(domain).length > 0;
}

/** Test seam. */
export function resetCaptureCache(): void {
  cache.clear();
}
