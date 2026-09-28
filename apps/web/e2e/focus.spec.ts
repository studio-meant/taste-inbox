import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * The Lab in a real browser — the smoke waiver `docs/DECISIONS.md` (2026-08-10) gave it is
 * lifted now that the screen exists again (NVIDIA_HACKATHON_PLAN §6.1).
 *
 * The route is `/focus/[itemId]` and the component is `FocusCanvas`; `Lab` is the name a
 * person reads (docs/next_step, 2026-09-28), which is why the panel names below are the
 * product's words and the selectors are the route's.
 *
 * Runs on the mock fixtures like the rest of the suite, so the canvas is in its honest
 * empty state: nothing researched, the sandbox unknown, and every button that would reach
 * the NVIDIA runtime either absent or disabled with the reason. The populated states are
 * covered by `tests/focus.test.tsx` against the service's own goldens; what this adds is
 * the four things jsdom cannot see — the route resolves, nothing collapses, no image
 * breaks, nothing fails behind it.
 */

function collectFailures(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${String(response.status())}: ${response.url()}`);
  });
  return errors;
}

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`the canvas opens from an item and renders at ${viewport.name} width`, async ({ page }) => {
    const failures = collectFailures(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await page.goto("/items/garden-lens", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Open in Lab/ }).click();

    await expect(page).toHaveURL(/\/focus\/garden-lens$/);
    const canvas = page.locator("[data-focus-canvas]");
    await expect(canvas).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "sample-org/garden-lens", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("문제가 생겼어요")).toHaveCount(0);

    // The honest empty state, stated in words.
    await expect(page.getByText("조사 전")).toBeVisible();
    await expect(page.getByRole("button", { name: "AI-Q로 조사하기" })).toBeDisabled();
    await expect(
      page.getByText(/목업 데이터 모드에서는 AI-Q와 샌드박스를 부르지 않아요/).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Try safely/ })).toHaveCount(0);
    for (const panel of [
      "Why this matters to you",
      "NVIDIA AI-Q 조사",
      "무엇을 확인하고 싶으세요?",
      "추천 검증 (Suggested Trial)",
      "Source Trail",
      "Policy Ledger",
      "Related Files",
    ]) {
      await expect(page.getByRole("heading", { name: panel, level: 2 })).toBeVisible();
    }

    // Nothing collapsed, and nothing overflows the page sideways.
    const panels = await page.locator("[data-focus-canvas] section").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      }),
    );
    for (const box of panels) {
      expect(box.w, `a panel is ${String(box.w)}px wide`).toBeGreaterThan(200);
      expect(box.h, `a panel is ${String(box.h)}px tall`).toBeGreaterThan(40);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const brokenImages = await page.locator("img").evaluateAll((nodes) =>
      nodes
        .filter((node): node is HTMLImageElement => node instanceof HTMLImageElement)
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.getAttribute("src") ?? "(no src)"),
    );
    expect(brokenImages, "broken images").toEqual([]);
    expect(failures, "console errors and failed requests").toEqual([]);
  });
}

test("an item that does not exist is a not-found page, not an error", async ({ page }) => {
  // The status is not asserted: the workspace streams behind `loading.tsx`, so the 200 is
  // on the wire before `notFound()` runs — the same as `/items/[id]`. The page is what a
  // person sees, and it must be the not-found page rather than an error boundary.
  await page.goto("/focus/no-such-item", { waitUntil: "networkidle" });
  await expect(page.getByText("찾을 수 없는 화면이에요")).toBeVisible();
  await expect(page.getByText("문제가 생겼어요")).toHaveCount(0);
  await expect(page.locator("[data-focus-canvas]")).toHaveCount(0);
});

test("the Lab leads back to the Inbox", async ({ page }) => {
  await page.goto("/focus/garden-lens", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Inbox" }).first().click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
});

test("the question composer is there, and says why it cannot be used yet", async ({ page }) => {
  /*
   * Mock mode reaches no AI-Q, so nothing has been researched and there is nothing to
   * condition a question on. The panel must say so rather than offering chips that would
   * be refused — `무엇을 확인할지는 사람` only means something if the choices are real.
   */
  await page.goto("/focus/garden-lens", { waitUntil: "networkidle" });

  const panel = page.getByRole("region", { name: "무엇을 확인하고 싶으세요?" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("list", { name: "확인해볼 만한 질문" })).toHaveCount(0);
  await expect(panel.getByRole("textbox")).toBeDisabled();
  await expect(panel.getByText(/먼저 이 항목을 조사하면/)).toBeVisible();
});
