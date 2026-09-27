import { defineConfig } from "@playwright/test";

/**
 * The smoke suite — the only tests in this repo that render a real page.
 *
 * It exists because of a measured gap, not a preference. In one session, four bugs each took
 * a whole screen down while all 657 unit tests passed:
 *
 *   1. one schemeless URL made the Style payload fail validation — the board never rendered
 *   2. `/api/media/:id` 404'd, so 297 images had no intrinsic size and the grid collapsed to 2px
 *   3. with no filter rail, the board landed in an `auto` grid track and collapsed to 2px again
 *   4. `BROWSE_MODES` crossed a `"use client"` boundary and arrived as a client reference,
 *      so three boards rendered a loading skeleton forever
 *
 * None of them is findable in jsdom: it has no layout engine (every element is 0×0), no
 * network, and no server/client boundary. These four are the shapes this config is aimed at.
 *
 * **Mock data, deliberately.** `NEXT_PUBLIC_DATA_SOURCE` is left at its default, so the suite
 * runs against committed fixtures and needs no API, no database and no collected content. That
 * keeps it deterministic and keeps the user's saved Instagram photographs out of a test run
 * (CLAUDE.md §10). It is the reason this catches (3) and (4) but not (1) and (2), which need
 * real payloads — that boundary is stated in `docs/DECISIONS.md` rather than left to be
 * discovered.
 */
export default defineConfig({
  testDir: "./e2e",
  // Serial. Six routes against one dev server is not worth the flake budget of parallelism.
  workers: 1,
  fullyParallel: false,
  // A screen that renders wrong renders wrong every time; a retry here would only hide flake.
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:4199",
    // The Mac's own Chrome. `channel` rather than Playwright's bundled Chromium so `pnpm
    // install` never pulls a ~150MB browser onto a machine whose disk budget is derived from
    // runtime detection (CLAUDE.md §8).
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    /*
     * A production build, not `next dev`, for two reasons.
     *
     * The first is forced: Next 16 keeps a per-directory lock on the dev server, so a smoke
     * run started while the user has `pnpm dev` open dies with "Another next dev server is
     * already running".
     *
     * The second is the better one. The dev server's hot-reload socket cannot complete a
     * handshake against a headless client, so it logs a console error on every page — which
     * meant the suite needed an allowlist to ignore it, and an allowlist is exactly how the
     * `/api/media` 404 would have slipped through again. Serving the build removes the noise
     * instead of filtering it, so "no console errors" can mean no console errors. The build
     * costs 5s.
     *
     * Port 4199, not the 4173 `pnpm dev` uses: a smoke run must not attach to whatever the
     * user happens to have open, and must not take that port away from them.
     */
    command: "pnpm exec next build && pnpm exec next start --port 4199",
    /*
     * Stated, never inherited.
     *
     * `resolveDataSource()` defaults to mock when the variable is unset, so an earlier draft
     * left it unset and assumed mock. It got live: `NEXT_PUBLIC_*` is inlined at build time,
     * and a build run from a shell that had it set — or against a `.next` a live `pnpm dev`
     * had already written — bakes that in. The suite then rendered the user's own collected
     * posts and hotlinked Instagram's CDN, which is neither deterministic nor allowed
     * (CLAUDE.md §10). Setting it explicitly is what makes "mock" true rather than likely.
     */
    env: {
      /*
       * A build directory of its own, so this run and a live `pnpm dev` stop overwriting
       * each other's `.next`. Read by `next.config.ts`; see the comment there for the
       * symptoms that led to it.
       */
      TASTE_INBOX_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_DATA_SOURCE: "mock",
      /*
       * Seed fixtures only — no `var/captures`.
       *
       * Mock mode is not hermetic by default: `lib/mock/captures.ts` reads the real
       * collections at request time when they exist, so that a developer sees their own
       * content without any of it being committed. Good for looking at; wrong for a test.
       * Left on, this suite rendered 76 of the user's saved posts and hotlinked Instagram's
       * CDN — and failed, because two of those signed URLs had expired. That is a fact about
       * how old a capture is, not about whether the code works.
       */
      TASTE_INBOX_USE_CAPTURES: "0",
    },
    url: "http://127.0.0.1:4199/today",
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
