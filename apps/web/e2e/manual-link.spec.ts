import { expect, test } from "@playwright/test";

test("a local user can add a link without a preview or background fetch", async ({ page }) => {
  const thirdPartyRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") thirdPartyRequests.push(request.url());
  });

  await page.goto("/library", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "링크 추가" }).click();

  const dialog = page.getByRole("dialog", { name: "링크 직접 추가" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("링크").fill("https://huggingface.co/datasets/sample-org/later");
  await expect(dialog.getByLabel("보드")).toHaveCount(0);
  await dialog.getByLabel(/제목/).fill("나중에 볼 데이터셋");
  await dialog.getByLabel(/메모/).fill("직접 적은 메모만 저장");
  await dialog.getByRole("button", { name: "저장" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status")).toHaveText("링크를 추가했어요.");
  expect(thirdPartyRequests).toEqual([]);
});
