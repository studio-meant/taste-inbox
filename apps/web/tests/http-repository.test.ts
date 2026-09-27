import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDataError, HttpRepository, TauriRepository } from "@/lib/repository";

/**
 * The live data layer, exercised.
 *
 * Until this file existed nothing in the repo drove `HttpRepository` at all
 * (`grep -rn "stubGlobal|globalThis.fetch|msw" apps/web packages` → 0 hits), so its
 * central promise — "a validation failure is a typed data error, never a crash" — was
 * only a docstring. Five methods were calling `Schema.parse` bare, which meant a renamed
 * field on the Python side reached the error boundary as a `ZodError` and the boundary
 * rendered its issue dump as `detail`.
 *
 * `vi.stubGlobal("fetch", …)` rather than a mock server: every one of these cases is about
 * what this class does with a body, and jsdom already supplies the rest of the runtime.
 */

const BASE = "http://127.0.0.1:8787";

/** One canned response for the next `fetch`, whatever the path. */
function respondWith(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ json: () => Promise.resolve(body) } as Response)),
  );
}

/** A Trends card that passes the shared schema, so tests can bend one field at a time. */
const VALID_AI_ITEM = {
  id: "gh-1",
  kind: "repo",
  title: "example/repo",
  summary: "",
  tags: [],
  links: [],
  preview: null,
  checkedAt: null,
  source: {
    platform: "github",
    label: "GitHub",
    originalUrl: "https://github.com/example/repo",
    firstSeenAt: "2026-08-08T07:00:00Z",
  },
};

const VALID_DETAIL_ITEM = {
  id: "manual-1",
  kind: "post",
  board: "music",
  title: "직접 추가한 링크",
  body: "내 메모",
  source: {
    platform: "instagram",
    label: "직접 추가 · Instagram",
    originalUrl: "https://www.instagram.com/reel/Manual_123/",
    author: null,
    actionType: null,
    firstSeenAt: "2026-08-08T07:00:00Z",
  },
  media: null,
  photos: [],
  tags: [],
  links: [],
  author: null,
  evidence: [],
  sourcePublishedAt: null,
  checkedAt: null,
  firstSeenAt: "2026-08-08T07:00:00Z",
};

function page(items: readonly unknown[]): unknown {
  return {
    data: {
      items,
      nextCursor: null,
      generatedAt: "2026-08-08T07:00:00Z",
      origin: "collected",
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transport failures", () => {
  it("reports an unreachable service as recoverable, because starting it is the fix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const error = await new HttpRepository(BASE).listAIItems().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiDataError);
    expect((error as ApiDataError).code).toBe("service_unreachable");
    // The user can act on this one: the service is a process on their own Mac.
    expect((error as ApiDataError).recoverable).toBe(true);
  });

  it("passes a typed error body through instead of restating it", async () => {
    // The service already decides both the wording and whether retrying helps; a client
    // that re-derived either would disagree with the API's own tests.
    respondWith({
      error: { code: "item_not_found", message: "그 항목을 찾을 수 없어요.", recoverable: false },
    });
    const error = await new HttpRepository(BASE)
      .getHostProfile()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiDataError);
    expect((error as ApiDataError).code).toBe("item_not_found");
    expect((error as ApiDataError).message).toBe("그 항목을 찾을 수 없어요.");
    expect((error as ApiDataError).recoverable).toBe(false);
  });
});

describe("desktop transport", () => {
  it("uses Tauri IPC and converts trusted cached-file markers without fetch", async () => {
    const invoke = vi.fn(() =>
      Promise.resolve(
        page([
          {
            ...VALID_AI_ITEM,
            preview: {
              id: "cover-1",
              type: "image",
              src: "taste-inbox-file:file:///Users/example/cover.jpg",
              width: 640,
              height: 640,
              alt: "저장한 표지",
              blurDataUrl: null,
            },
          },
        ]),
      ),
    );
    const convertFileSrc = vi.fn((path: string) => `asset://localhost${path}`);
    vi.stubGlobal("__TAURI__", { core: { invoke, convertFileSrc } });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch must not run"))),
    );

    const result = await new TauriRepository().listAIItems({ day: "2026-08-08" });

    expect(invoke).toHaveBeenCalledWith("bridge_request", {
      request: { method: "GET", path: "/api/trends/items?day=2026-08-08" },
    });
    expect(convertFileSrc).toHaveBeenCalledWith("/Users/example/cover.jpg");
    expect(result.items[0]?.preview?.src).toBe("asset://localhost/Users/example/cover.jpg");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("board pages", () => {
  it("names the 1-based row when one item breaks the contract", async () => {
    // The whole reason both languages share one schema: the mismatch has to be findable
    // without reading three layers of undefined.
    const broken = { ...VALID_AI_ITEM, id: "gh-2" };
    delete (broken as { title?: string }).title;
    respondWith(page([VALID_AI_ITEM, broken]));
    const error = await new HttpRepository(BASE).listAIItems().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiDataError);
    expect((error as ApiDataError).code).toBe("invalid_item");
    expect((error as ApiDataError).message).toContain("2번째");
  });

  it("treats an envelope with no items as bad data, not a TypeError", async () => {
    // `raw.items.entries()` on `{data:{}}` threw `Cannot read properties of undefined`,
    // which is not an ApiDataError and so skipped every typed-error path the boundaries have.
    respondWith({ data: {} });
    const error = await new HttpRepository(BASE).listAIItems().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiDataError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect((error as ApiDataError).code).toBe("invalid_response");
  });
});

/** Answers every request with an empty page and records the URL that was asked for. */
function recordRequests(): { readonly urls: readonly string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: unknown) => {
      urls.push(String(input));
      return Promise.resolve({ json: () => Promise.resolve(page([])) } as Response);
    }),
  );
  return { urls };
}

describe("filters on the wire", () => {
  it("sends the merged board's source filter to the music list too", async () => {
    /*
     * The one part of `/library`'s "a parsed filter must be applied" that a component test
     * cannot see: mock mode filters in process, so a `source` the live client forgot to
     * serialise would pass every jsdom test and put Instagram Reels on `?source=github`
     * against the real service.
     */
    const { urls } = recordRequests();

    await new HttpRepository(BASE).listMusicItems({ source: ["github"] });

    expect(urls[0]).toContain("source=github");
  });

  it("sends ?day= to all three boards, so the calendar is not a client-side illusion", async () => {
    /*
     * The half-fix this guards against passes every jsdom test: mock mode filters in
     * process, so a `day` the live client never serialised would look correct in every
     * component test and answer `?day=2026-08-08` with every day the service has —
     * the failure docs/DECISIONS.md (2026-08-08) calls worse than not offering the filter.
     */
    const { urls } = recordRequests();
    const repository = new HttpRepository(BASE);

    await repository.listAIItems({ day: "2026-08-08" });
    await repository.listStyleItems({ day: "2026-08-08" });
    await repository.listMusicItems({ day: "2026-08-08" });

    expect(urls).toEqual([
      `${BASE}/api/trends/items?day=2026-08-08`,
      `${BASE}/api/style/items?day=2026-08-08`,
      `${BASE}/api/music/items?day=2026-08-08`,
    ]);
  });

  it("keeps a day and a source in the same request", async () => {
    // `/library` can carry both, and dropping either would answer a shared link with a
    // board it does not describe.
    const { urls } = recordRequests();

    await new HttpRepository(BASE).listStyleItems({ source: ["instagram"], day: "2026-08-10" });

    expect(urls[0]).toContain("source=instagram");
    expect(urls[0]).toContain("day=2026-08-10");
  });

  it("leaves the query bare when nothing is filtered", async () => {
    // A board with no filter has a canonical URL, here as well as in the address bar.
    const { urls } = recordRequests();

    await new HttpRepository(BASE).listMusicItems();

    expect(urls[0]).toBe(`${BASE}/api/music/items`);
  });
});

describe("single-payload endpoints", () => {
  it("posts a validated manual link and reads back the typed item", async () => {
    respondWith({ data: { created: true, item: VALID_DETAIL_ITEM } });
    const repository = new HttpRepository(BASE);

    const result = await repository.createManualItem({
      url: "https://www.instagram.com/reel/Manual_123/",
      board: "music",
      note: "내 메모",
    });

    expect(result.item.id).toBe("manual-1");
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/api/items/manual`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://www.instagram.com/reel/Manual_123/",
          board: "music",
          note: "내 메모",
        }),
      }),
    );
  });

  it("refuses a non-web manual link before making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const repository = new HttpRepository(BASE);

    const error = await repository
      .createManualItem({ url: "javascript:alert(1)", board: "trends" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiDataError);
    expect((error as ApiDataError).code).toBe("manual_item_rejected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns a wrong-typed Today field into an ApiDataError, not a ZodError", async () => {
    // A ZodError here reached the boundary, which renders `detail={error.message}` — the
    // user got a JSON issue dump where a sentence belongs.
    respondWith({ data: { date: 20260808, greeting: null } });
    const error = await new HttpRepository(BASE).getToday().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiDataError);
    expect((error as Error).name).toBe("ApiDataError");
    expect((error as ApiDataError).code).toBe("invalid_response");
  });

  it("treats a jobs envelope with no list as bad data", async () => {
    // Same hole as the boards, via `.map` instead of `.entries()`. The shell asks for jobs
    // on every render, so this one would have taken down the whole workspace.
    respondWith({ data: {} });
    const error = await new HttpRepository(BASE).listJobs().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiDataError);
    expect((error as ApiDataError).code).toBe("invalid_response");
  });
});
