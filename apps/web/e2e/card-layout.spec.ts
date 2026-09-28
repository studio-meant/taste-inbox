import { expect, test } from "@playwright/test";

test("Browse omits the explanatory banner requested for removal", async ({ page }) => {
  await page.goto("/library", { waitUntil: "networkidle" });
  await expect(page.getByText(/각 보드와 미분류 항목을 고유한 색과 모양/)).toHaveCount(0);
});

test("Today's New signals counts by kind and invents no pictures", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });
  const saved = page.getByRole("region", { name: "New signals" });
  await expect(saved.getByText("Repo 2")).toBeVisible();
  await expect(saved.locator("img")).toHaveCount(0);
});

// Seed fixtures only (playwright.config.ts): `sample-org` is nobody's account.
for (const width of [390, 900, 1280, 1586]) {
  for (const route of ["/library"]) {
    test(`${route} keeps complete card rows at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route, { waitUntil: "networkidle" });
      const cards = page.locator('article:has(h3[id^="browse-"])');
      await expect(cards.first()).toBeVisible();

      const problems = await cards.evaluateAll((nodes) => {
        const failures: string[] = [];
        for (const card of nodes) {
          const body = card.querySelector<HTMLElement>(':scope > div[class*="body"]');
          if (!body) {
            failures.push("Missing card body");
            continue;
          }
          const bounds = card.getBoundingClientRect();
          const name = card.getAttribute("aria-labelledby") ?? "card";
          if (body.scrollHeight > body.clientHeight + 1) failures.push(`${name}: body overflow`);
          let previousBottom = body.getBoundingClientRect().top;
          for (const child of Array.from(body.children)) {
            const rect = child.getBoundingClientRect();
            if (rect.height === 0) continue;
            if (rect.top < previousBottom - 1) failures.push(`${name}: body rows overlap`);
            if (rect.bottom > bounds.bottom - 1) failures.push(`${name}: clipped footer/body`);
            previousBottom = rect.bottom;
          }
          for (const text of body.querySelectorAll<HTMLElement>('h3, p[class*="subtitle"]')) {
            const line = Number.parseFloat(getComputedStyle(text).lineHeight);
            const lines = text.getBoundingClientRect().height / line;
            if (lines < 0.99 || Math.abs(lines - Math.round(lines)) > 0.04) {
              failures.push(`${name}: partial text line (${String(lines)})`);
            }
          }
          for (const control of body.querySelectorAll("a, select")) {
            const rect = control.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (
              rect.left < bounds.left ||
              rect.right > bounds.right + 1 ||
              rect.bottom > bounds.bottom
            ) {
              failures.push(`${name}: control outside card`);
            }
          }
        }
        return failures;
      });
      expect(problems).toEqual([]);
      await expect(page.getByText("자세히 보기", { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    });
  }
}

test("the Inbox card's upper right is Open in Lab, and the source link is in the body", async ({
  page,
}) => {
  /*
   * The corner slot changed hands (2026-09-28). It held the source badge — a label
   * pointing off the product — and the Inbox's whole job is to get one item into the Lab,
   * so the corner is the action and the platform permalink leads the card's link list.
   */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/library", { waitUntil: "networkidle" });

  // A card that offers the Lab *and* carries the link list — the two halves of the swap.
  const card = page
    .locator('article:has(a[href^="/focus/"]):has(ul[aria-label="바로가기"])')
    .first();
  await expect(card).toBeVisible();
  const lab = card.getByRole("link", { name: /Open in Lab/ }).first();
  const position = await lab.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const box = node.closest("article")?.getBoundingClientRect();
    if (!box) throw new Error("the Lab link is not inside a card");
    return { right: box.right - rect.right, top: rect.top - box.top };
  });
  expect(position.right).toBeGreaterThanOrEqual(8);
  expect(position.right).toBeLessThanOrEqual(16);
  expect(position.top).toBeLessThan(80);
  await expect(lab).toHaveAttribute("href", /^\/focus\//u);

  // The source is still one click away, in the list of everywhere else this item points.
  const source = card.getByRole("list", { name: "바로가기" }).getByRole("link").first();
  await expect(source).toHaveAttribute("href", /^https?:\/\//u);
  await expect(source).toHaveAttribute("target", "_blank");
});

test("an Inbox link opens its original in a new tab, not the item's page", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // No real external request is needed to test navigation.
  await context.route(/^https:\/\/(www\.)?(github\.com|huggingface\.co)\//, (route) =>
    route.fulfill({ body: "Original fixture", contentType: "text/html" }),
  );
  await page.goto("/library", { waitUntil: "networkidle" });

  const link = page
    .locator("article")
    .getByRole("list", { name: "바로가기" })
    .getByRole("link", { name: /GitHub 스타/ })
    .first();
  const original = await link.getAttribute("href");
  if (!original) throw new Error("Missing original URL");
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(original);
  await popup.close();
  await expect(page).toHaveURL(/\/library$/);

  // The title is the way to the item's own page, and it remembers where it came from.
  await page.getByRole("link", { name: "sample-org/garden-lens", exact: true }).click();
  await expect(page).toHaveURL(/\/items\/garden-lens\?from=%2Flibrary$/);
});
