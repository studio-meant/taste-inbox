import type { NextConfig } from "next";

/**
 * Local-first single-user dashboard.
 *
 * No external telemetry, no remote image hosts, no cloud infrastructure
 * (CLAUDE.md §10, DESIGN.md §28). Media is served from the local cache, which Phase 2
 * introduces behind the API.
 */
/**
 * Where the API lives. Loopback only — the service is one process on this Mac.
 *
 * Kept in step with `src/lib/repository/index.ts`, which reads the same variable to decide
 * where *server-side* fetches go. This one is for the requests the browser makes on its
 * own.
 */
const API_URL = process.env.TASTE_INBOX_API_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  /*
   * Where the build lands, so a smoke run and a dev server can coexist.
   *
   * `pnpm e2e` runs `next build && next start` while the developer usually has `pnpm dev`
   * open, and both wrote `.next`. They fight over it: the build overwrites what the dev
   * server is serving, the dev server rewrites what the build just produced, and the
   * symptoms are the confusing kind — three web tests failing only inside `verify:all`, a
   * `next build` this file's own comment calls "5s" timing out at 180s, and an e2e run that
   * took 15.8 minutes. The hazard was even written down a few lines below in
   * `playwright.config.ts` ("against a `.next` a live `pnpm dev` had already written") as a
   * reason to set `NEXT_PUBLIC_DATA_SOURCE` explicitly — the same collision, met earlier and
   * patched at the symptom.
   *
   * The e2e config sets this; nothing else does, so an ordinary `next dev` or `next build`
   * is untouched.
   */
  distDir: process.env.TASTE_INBOX_DIST_DIR ?? ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * `127.0.0.1` is a first-class address for this product, not a stranger.
   *
   * Next 16 blocks cross-origin requests to `/_next/*` in development, and it treats
   * `127.0.0.1` as a different origin from the `localhost` it prints on startup. The effect
   * is silent and total: the page renders server-side and looks perfect, every client chunk
   * 403s, nothing hydrates, and no button on any screen does anything. The entry sequence
   * was the screen that made it obvious — neither Enter nor a click advanced it — but every
   * Client Component in the app was equally dead.
   *
   * It matters here because the loopback IP is what this product uses for itself:
   * `DEFAULT_API_URL` is `http://127.0.0.1:8787`, `scripts/dev.sh` prints
   * `http://127.0.0.1:4173`, and the API binds `127.0.0.1`. Telling the user to open an
   * address whose JavaScript we block would be a strange way to ship a local-first app.
   *
   * Development only — `next start` never applies it.
   */
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@taste-inbox/ui", "@taste-inbox/shared"],
  typedRoutes: true,
  images: {
    // Phase 0 renders no remote media. Phase 2 adds the local media cache origin.
    remotePatterns: [],
  },
  /**
   * Send `/api/media/*` to the API rather than looking for a page of that name.
   *
   * A card's photo arrives from the API as the path `/api/media/51`, which is relative to
   * whatever origin loaded the page — so with the web app on :4173 the browser asked
   * :4173 and got a 404. Every photo on every board was broken, and because a broken image
   * has no intrinsic size the whole Style grid collapsed to two pixels wide: 76 cards in
   * the DOM, nothing on screen.
   *
   * A rewrite rather than an absolute URL from the API, because the path is the honest
   * answer: the API does not know what origin is asking, and baking :8787 into stored data
   * would make the port part of the payload.
   *
   * Only `/api/media` is forwarded. Board data is fetched server-side by the repository,
   * which already talks to the API directly, and mock media lives under `/mock-media`.
   */
  rewrites() {
    return Promise.resolve([
      { source: "/api/media/:path*", destination: `${API_URL}/api/media/:path*` },
    ]);
  },
};

export default nextConfig;
