import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 900, height: 900 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`item detail is readable without clipping at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/items/sample-reasoning-paper", { waitUntil: "networkidle" });

    const detail = page.locator("[data-item-detail]");
    await expect(detail).toBeVisible();
    await expect(page.getByRole("heading", { name: /Sample Reasoning/, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /원본 열기/ })).toHaveAttribute("target", "_blank");
    // Where the paper points — its code, its demo, its page.
    await expect(page.getByRole("list", { name: "이 항목이 가리키는 곳" })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const box = await detail.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(280);
    expect(box?.height ?? 0).toBeGreaterThan(300);

    const evidence = page.locator("details").filter({ hasText: "확인한 정보" });
    await expect(evidence).not.toHaveAttribute("open", "");
    await evidence.locator("summary").click();
    await expect(evidence).toHaveAttribute("open", "");
  });
}

test("an item has a complete, centered reading layout and no board to pick", async ({ page }) => {
  await page.goto("/items/garden-lens", { waitUntil: "networkidle" });

  await expect(page.locator("[data-item-detail]")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "sample-org/garden-lens", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /원본 열기/ })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("detail back link restores the Inbox's filters", async ({ page }) => {
  await page.goto("/library?kind=repo&source=github", { waitUntil: "networkidle" });

  const itemLink = page.locator('a[href^="/items/"]').first();
  await expect(itemLink).toBeVisible();
  await itemLink.click();
  await expect(page.locator("[data-item-detail]")).toBeVisible();

  // The detail page's own back link, not the navigation's Inbox destination.
  await page.locator("[data-item-detail]").getByRole("link", { name: "Inbox" }).click();
  await expect(page).toHaveURL(/\/library\?kind=repo&source=github$/u);
});
