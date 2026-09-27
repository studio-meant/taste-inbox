import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 900, height: 900 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`item detail is readable without clipping at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/items/cropped-shell-jacket", { waitUntil: "networkidle" });

    const detail = page.locator("[data-item-detail]");
    await expect(detail).toBeVisible();
    await expect(page.getByRole("heading", { name: /워시드 세이지/, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /원본 게시물 열기/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(page.getByRole("button", { name: "다음 사진" })).toBeVisible();
    await expect(page.getByText("1 / 3")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const box = await detail.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(280);
    expect(box?.height ?? 0).toBeGreaterThan(500);

    const evidence = page.locator("details").filter({ hasText: "확인한 정보" });
    await expect(evidence).not.toHaveAttribute("open", "");
    await evidence.locator("summary").click();
    await expect(evidence).toHaveAttribute("open", "");
  });
}

test("the detail carousel changes the main photograph and wraps around", async ({ page }) => {
  await page.goto("/items/cropped-shell-jacket", { waitUntil: "networkidle" });

  const stage = page.locator("[data-gallery-stage]");
  await expect(stage.locator("img")).toHaveAttribute("src", /cropped-shell-jacket/);
  await page.getByRole("button", { name: "다음 사진" }).click();
  await expect(stage.locator("img")).toHaveAttribute("src", /grey-pleated-skirt/);
  await expect(page.getByText("2 / 3")).toBeVisible();
  await page.getByRole("button", { name: "이전 사진" }).click();
  await expect(page.getByText("1 / 3")).toBeVisible();
});

test("an item without media still has a complete, centered reading layout", async ({ page }) => {
  await page.goto("/items/garden-lens", { waitUntil: "networkidle" });

  await expect(page.locator("[data-item-detail]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Garden Lens", level: 1 })).toBeVisible();
  await expect(page.locator("[data-item-gallery]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /원본 게시물 열기/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /보드/ })).toHaveCount(0);
});

test("detail back link restores both board type and source filters", async ({ page }) => {
  await page.goto("/trends?kind=repo&source=github", { waitUntil: "networkidle" });

  const itemLink = page.locator('a[href^="/items/"]').first();
  await expect(itemLink).toBeVisible();
  await itemLink.click();
  await expect(page.locator("[data-item-detail]")).toBeVisible();

  // The board name is gone from the user-facing copy in this edition; the link still
  // restores the exact filtered board it came from.
  await page.getByRole("link", { name: /돌아가기/ }).click();
  await expect(page).toHaveURL(/\/trends\?kind=repo&source=github$/u);
});

test("a stored Reel frame loads Instagram only after an explicit click", async ({ page }) => {
  let instagramRequests = 0;
  await page.route("https://www.instagram.com/**", async (route) => {
    instagramRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>Instagram embed fixture</body></html>",
    });
  });
  await page.goto("/items/reel-rainy-day-list", { waitUntil: "networkidle" });

  const play = page.getByRole("button", { name: "앱에서 영상 재생" });
  await expect(play).toBeVisible();
  await expect(page.getByText(/미디어는 따로 저장하지 않아요/)).toBeVisible();
  await expect(page.locator("iframe[title$='Instagram 게시물']")).toHaveCount(0);
  expect(instagramRequests).toBe(0);

  const stage = page.locator("[data-gallery-stage]");
  const stageBefore = await stage.boundingBox();
  const consentBefore = await page.locator("[data-instagram-embed-consent]").boundingBox();
  expect(
    Math.abs(
      (stageBefore?.y ?? 0) +
        (stageBefore?.height ?? 0) / 2 -
        ((consentBefore?.y ?? 0) + (consentBefore?.height ?? 0) / 2),
    ),
  ).toBeLessThanOrEqual(2);

  await play.click();
  const frame = page.locator("iframe[title$='Instagram 게시물']");
  await expect(frame).toHaveAttribute(
    "src",
    "https://www.instagram.com/reel/example-rainy-day/embed/",
  );
  await expect.poll(() => instagramRequests).toBe(1);
  await expect(page.getByRole("link", { name: /Instagram에서 열기/ })).toHaveAttribute(
    "href",
    "https://www.instagram.com/reel/example-rainy-day/",
  );

  const stageAfter = await stage.boundingBox();
  const panelAfter = await page.locator("[data-instagram-embed]").boundingBox();
  expect(Math.abs((stageAfter?.y ?? 0) - (panelAfter?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((stageAfter?.height ?? 0) - (panelAfter?.height ?? 0))).toBeLessThanOrEqual(1);
});
