import { expect, test } from "@playwright/test";

test("Browse omits the explanatory banner requested for removal", async ({ page }) => {
  await page.goto("/library", { waitUntil: "networkidle" });
  await expect(page.getByText(/각 보드와 미분류 항목을 고유한 색과 모양/)).toHaveCount(0);
});

test("Today fills Saved Items only with real recent previews", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });
  const saved = page.getByRole("region", { name: "Saved Items" });
  await expect(saved.locator("img")).toHaveCount(3);
  await expect(saved.locator("img").nth(0)).toHaveAttribute("alt", /.+/);
  await expect(saved.locator("img").nth(1)).toHaveAttribute("alt", /.+/);
  await expect(saved.locator("img").nth(2)).toHaveAttribute("alt", /.+/);
});

// Seed fixtures only (playwright.config.ts). In particular, the three shop links are
// invented fixture content, not the user's profile or saved Instagram photographs.
for (const width of [390, 900, 1280, 1586]) {
  for (const route of ["/style", "/trends", "/library"]) {
    test(`${route} keeps complete card rows at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route, { waitUntil: "networkidle" });
      const cards = page.locator('article:has(h3[id^="browse-"])');
      await expect(cards.first()).toBeVisible();
      if (route !== "/trends") {
        await expect(page.getByRole("list", { name: "작성자의 판매처" }).locator("li")).toHaveCount(
          3,
        );
      }

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

for (const width of [390, 900, 1280, 1586]) {
  for (const route of ["/music", "/library"]) {
    test(`${route} keeps square Music text clear of both actions at ${String(width)}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(route, { waitUntil: "networkidle" });
      const cards = page.locator('article:has(h3[id^="music-shelf-"])');
      await expect(cards.first()).toBeVisible();
      await expect(cards.locator("select")).toHaveCount(0);

      const geometry = await cards.evaluateAll((nodes) =>
        nodes.map((card) => {
          const bounds = card.getBoundingClientRect();
          const source = card.querySelector('a[target="_blank"]')?.getBoundingClientRect();
          const meta = card.querySelector('[class*="shelfMeta"]');
          const first = meta?.firstElementChild?.getBoundingClientRect();
          if (!source || !meta || !first) throw new Error("Missing Music source or text");
          const text = Array.from(meta.children)
            .map((child) => child.getBoundingClientRect())
            .filter((rect) => rect.height > 0);
          const last = text.at(-1);
          const summary = card.querySelector("summary")?.getBoundingClientRect();
          if (!last || !summary) throw new Error("Missing Music caption or track control");
          return {
            square: Math.abs(bounds.width - bounds.height),
            topGap: first.top - source.bottom,
            bottomGap: summary.top - last.bottom,
            rightInset: bounds.right - source.right,
            summaryInset: bounds.bottom - summary.bottom,
            textInside: text.every(
              (rect) =>
                rect.left >= bounds.left &&
                rect.right <= bounds.right &&
                rect.bottom <= bounds.bottom,
            ),
          };
        }),
      );
      for (const item of geometry) {
        expect(item.square).toBeLessThanOrEqual(1);
        expect(item.topGap).toBeGreaterThanOrEqual(0);
        expect(item.bottomGap).toBeGreaterThanOrEqual(6);
        expect(item.rightInset).toBeGreaterThanOrEqual(8);
        expect(item.rightInset).toBeLessThanOrEqual(16);
        expect(item.summaryInset).toBeGreaterThanOrEqual(8);
        expect(item.textInside).toBe(true);
      }
      // The full song list and its hand-off links still work inside the sleeve.
      const withTracks = cards.filter({ hasText: "4곡" }).first();
      await withTracks.locator("summary").click();
      await expect(withTracks.getByRole("list", { name: "추천된 곡" }).locator("li")).toHaveCount(
        4,
      );
      await expect(
        withTracks.getByRole("link", { name: /YouTube Music에서 찾기/ }).first(),
      ).toBeVisible();
      await withTracks.locator("summary").click();
      if (width === 1586 && route === "/music") {
        await page.screenshot({ path: testInfo.outputPath("music-shelf.png") });
      }
    });
  }
}

test("source pills open originals from the upper right, without opening item details", async ({
  page,
  context,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // No real external requests or signed-in browser session is needed to test navigation.
  await context.route(/^https:\/\/(www\.)?(instagram\.com|threads\.com|github\.com)\//, (route) =>
    route.fulfill({ body: "Original post fixture", contentType: "text/html" }),
  );
  await page.goto("/library", { waitUntil: "networkidle" });
  for (const name of ["Instagram 좋아요", "Instagram 저장", "Threads 리포스트", "GitHub 스타"]) {
    const link = page
      .locator("article")
      .getByRole("link", { name: new RegExp(name) })
      .first();
    await link.scrollIntoViewIfNeeded();
    const original = await link.getAttribute("href");
    if (!original) throw new Error("Missing original-post URL");
    const position = await link.evaluate((node) => {
      const card = node.closest("article")?.getBoundingClientRect();
      if (!card) throw new Error("Source link is not inside a card");
      const rect = node.getBoundingClientRect();
      return {
        right: card.right - rect.right,
        top: rect.top - card.top,
        radius: getComputedStyle(node).borderRadius,
        background: getComputedStyle(node).backgroundColor,
      };
    });
    expect(position.right).toBeGreaterThanOrEqual(8);
    expect(position.right).toBeLessThanOrEqual(16);
    expect(position.top).toBeLessThanOrEqual(16);
    expect(position.radius).not.toBe("0px");
    expect(position.background).not.toBe("rgba(0, 0, 0, 0)");
    const popupPromise = page.waitForEvent("popup");
    await link.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(original);
    await popup.close();
    await expect(page).toHaveURL(/\/library$/);
  }
  const shopCard = page.locator("article:has(#browse-cropped-shell-jacket)");
  await shopCard.scrollIntoViewIfNeeded();
  await shopCard.screenshot({ path: testInfo.outputPath("style-card.png") });
  await shopCard
    .getByRole("link", { name: "워시드 세이지 컬러의 라이트 셸 재킷", exact: true })
    .click();
  // The card carries where it was opened from, so the detail page's back link returns to
  // this board (`safeBoardReturnHref`). The pattern used to end at the id and failed on it.
  await expect(page).toHaveURL(/\/items\/cropped-shell-jacket\?from=%2Flibrary$/);
});
