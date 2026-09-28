import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * Does every screen actually render?
 *
 * Each assertion here is a bug that happened, not a hypothetical. The suite is deliberately
 * shallow: it never asserts copy, colour or position — that is what the unit tests and
 * `design-qa.md` are for. It asserts that the page exists, has content, and is not silently
 * broken in one of the four ways jsdom cannot see.
 */

/**
 * Every card on every screen, whatever element it happens to be.
 *
 * `CardSurface` renders a `div` on Today, an `article` on the boards and a `section`
 * elsewhere, so it carries `data-card` for exactly this. `BrowseCard` builds its own
 * `<article>` and is matched by the second half.
 */
const CARD = "[data-card], article";

/** Every route a person can reach, and what "it rendered" means for each. */
const SCREENS = [
  { path: "/today", name: "Today", heading: "Today", minCards: 3 },
  // The Inbox is the one list since 2026-09-28 — the Trends, Style, Music, Places and None
  // boards went with Instagram. Every collected item is on it, so it cannot be short.
  { path: "/library", name: "Inbox", heading: "Inbox", minCards: 3 },
  // System lives inside Settings since 2026-09-28 — its health cards are the minimum.
  { path: "/settings", name: "Settings", heading: "Settings", minCards: 1 },
  // Mock data is already set up, so this is the returning form: the same four answers.
  { path: "/onboarding", name: "Onboarding", heading: "시작 설정", minCards: 0 },
] as const;

test("/system is Settings now, and says so by moving there", async ({ page }) => {
  await page.goto("/system");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});

/*
 * There is no allowlist here, and that is the point.
 *
 * An earlier draft ran against `next dev`, whose hot-reload socket logs a console error on
 * every headless page load, so it needed a filter — and a filter is exactly how the
 * `/api/media` 404 that broke every image on every board would have slipped past a second
 * time. The suite serves a production build instead, where that noise does not exist, so
 * "no console errors" can mean no console errors.
 */

function collectFailures(page: Page): { readonly errors: string[] } {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    errors.push(`console: ${message.text()}`);
  });

  page.on("response", (response) => {
    if (response.status() < 400) return;
    errors.push(`${String(response.status())}: ${response.url()}`);
  });

  return { errors };
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test(`renders, with nothing broken behind it`, async ({ page }) => {
      const failures = collectFailures(page);

      await page.goto(screen.path, { waitUntil: "networkidle" });

      // 1. The page is the page, and not an error boundary wearing its URL.
      await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
      await expect(page.getByText("문제가 생겼어요")).toHaveCount(0);

      // 2. Content arrived. A skeleton that never resolves is the exact shape of the
      //    `BROWSE_MODES` bug: 200 OK, correct heading, and three boards showing placeholders
      //    forever.
      if (screen.minCards > 0) {
        await expect
          .poll(async () => page.locator(CARD).count(), { timeout: 20_000 })
          .toBeGreaterThanOrEqual(screen.minCards);
      }
      await expect(page.getByText("화면을 준비하고 있어요")).toHaveCount(0);

      // 3. Nothing collapsed. Both 2px bugs left a full DOM and a blank screen, so counting
      //    elements would have passed; only a measured box catches it.
      const boxes = await page.locator(CARD).evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { w: Math.round(rect.width), h: Math.round(rect.height) };
        }),
      );
      for (const box of boxes) {
        expect(box.w, `a card is ${String(box.w)}px wide`).toBeGreaterThan(80);
        expect(box.h, `a card is ${String(box.h)}px tall`).toBeGreaterThan(24);
      }

      // 4. Every image resolved. `complete && naturalWidth === 0` is a load that failed —
      //    which is what a 404 looks like from inside the page.
      const brokenImages = await page.locator("img").evaluateAll((nodes) =>
        nodes
          .filter((node): node is HTMLImageElement => node instanceof HTMLImageElement)
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.getAttribute("src") ?? "(no src)"),
      );
      expect(brokenImages, "broken images").toEqual([]);

      // 5. Nothing failed quietly on the way.
      expect(failures.errors, "console errors and failed requests").toEqual([]);
    });
  });
}

/**
 * `/` — the entry ceremony.
 *
 * Not a row in `SCREENS`, for two reasons that are facts about the screen rather than
 * preferences. Its `<h1>` is the greeting line, which is *data* — `TodayPayload.greeting`
 * — so there is no fixed heading to match on. And it advances on its own (IA §7.0 forbids
 * holding the Splash), so for ~820ms two scene layers are co-mounted and a bare
 * `getByRole("heading", { level: 1 })` matches twice and trips strict mode. Everything is
 * scoped to `[data-phase]`, the controller's own hook for which screen is on top.
 *
 * The suite runs on mock fixtures (see the config), so
 * `general.ceremonialEntry` is the shipped default `full` — Splash, then Greeting, then
 * Today — and nothing here depends on collected content.
 */
test.describe("Entry", () => {
  const GREETING = '[data-phase="greeting"]';

  test("renders, with nothing broken behind it", async ({ page }) => {
    const failures = collectFailures(page);

    await page.goto("/", { waitUntil: "networkidle" });

    // 1. The ceremony resolved to the Greeting by itself. No click, no keypress.
    const greeting = page.locator(GREETING);
    await expect(greeting).toBeVisible();
    await expect(greeting.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("문제가 생겼어요")).toHaveCount(0);
    await expect(page.getByText("화면을 준비하고 있어요")).toHaveCount(0);

    // 2. Nothing collapsed. This screen is four absolutely positioned children of a frame
    //    that has no content flow to prop it open — exactly the shape of the two 2px bugs.
    const frame = await greeting.boundingBox();
    expect(frame?.width ?? 0, "the ceremonial frame width").toBeGreaterThan(600);
    expect(frame?.height ?? 0, "the ceremonial frame height").toBeGreaterThan(400);

    // 3. The scenic backdrop is the whole picture on this screen; a 0-height SVG is a
    //    blank cream rectangle with white text on it.
    const art = await greeting.locator("svg[viewBox='0 0 1440 960']").boundingBox();
    expect(art?.height ?? 0, "the scenic art height").toBeGreaterThan(200);

    // 4. Every image resolved.
    const brokenImages = await page.locator("img").evaluateAll((nodes) =>
      nodes
        .filter((node): node is HTMLImageElement => node instanceof HTMLImageElement)
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.getAttribute("src") ?? "(no src)"),
    );
    expect(brokenImages, "broken images").toEqual([]);

    // 5. Nothing failed quietly on the way.
    expect(failures.errors, "console errors and failed requests").toEqual([]);
  });

  test("leads to Today when pressed", async ({ page }) => {
    const failures = collectFailures(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator(GREETING).getByRole("button", { name: "눌러서 시작하기" }).click();

    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    expect(failures.errors, "console errors and failed requests").toEqual([]);
  });

  test("leads to Today by keyboard alone", async ({ page }) => {
    // The front door must not need a pointer. `⌘ Enter` is printed on the screen, so it
    // has to be the thing that works — in the reference those two caps are decoration.
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator(GREETING)).toBeVisible();

    await page.keyboard.press("Meta+Enter");

    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  });

  test("is not the only way in", async ({ page }) => {
    // Whatever the ceremony does, `/today` stays a URL a person can simply open.
    await page.goto("/today", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  });
});

test.describe("The page body", () => {
  test("never scrolls sideways at a normal desktop width", async ({ page }) => {
    // Wide content — a long repository name, a long URL — has to scroll inside its own
    // container. A page that scrolls horizontally has already lost its layout.
    for (const screen of [...SCREENS, { path: "/" }]) {
      await page.goto(screen.path, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${screen.path} overflows by ${String(overflow)}px`).toBeLessThanOrEqual(1);
    }
  });

  /*
   * One test per screen, not one test over all of them.
   *
   * The first version looped every screen inside a single test. It passed at seven screens
   * and, at nine, spent longer than the 60s test timeout on `goto` + wheel + settle — so it
   * failed as a timeout at whichever screen it happened to be on, told you nothing about
   * which, and burned 15.8 minutes doing it across retries. A per-screen test costs the same
   * total work, names the screen that broke, and gets its own clock.
   */
  for (const screen of SCREENS) {
    test(`${screen.name} can be scrolled to content below the fold`, async ({ page }) => {
      /*
       * The sibling above asks that the page not scroll sideways. Nothing asked that it
       * scroll *down*, and for a while it did not: `.shell` was `min-height: 100dvh`, so the
       * whole stage grew to fit — 23,391px on a board — and `.viewport`, the one element with
       * `overflow-y: auto`, ended up exactly as tall as its content and never became a
       * scroll container. Its `overscroll-behavior: contain` then swallowed the wheel rather
       * than letting it chain to the document. 22,491px of collected items sat below the
       * fold, unreachable by any gesture, while every other assertion in this file passed.
       *
       * Deliberately a real wheel rather than `scrollIntoView` or a programmatic `scrollTo`:
       * both of those reach a scroller the person's mouse cannot.
       */
      await page.setViewportSize({ width: 1280, height: 500 });
      await page.goto(screen.path, { waitUntil: "networkidle" });

      const scrollable = await page.evaluate(() => {
        const viewport = document.querySelector('[class*="viewport"]');
        return viewport === null ? -1 : viewport.scrollHeight - viewport.clientHeight;
      });
      expect(scrollable, `${screen.path} has no viewport element at all`).toBeGreaterThanOrEqual(0);

      if (screen.minCards === 0) {
        /*
         * A screen with nothing below the fold cannot be asked to scroll to it, and demanding
         * that would make an honest empty state fail. What it still owes is a viewport, which
         * the assertion above took.
         */
        return;
      }

      expect(scrollable, `${screen.path} should have content below a 500px fold`).toBeGreaterThan(
        0,
      );

      await page.mouse.move(640, 250);
      await page.mouse.wheel(0, 400);
      await expect
        .poll(async () =>
          page.evaluate(() => document.querySelector('[class*="viewport"]')?.scrollTop ?? 0),
        )
        .toBeGreaterThan(0);
    });
  }
});
