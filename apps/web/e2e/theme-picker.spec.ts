import { expect, test } from "@playwright/test";

/**
 * Changing the theme, in a real browser.
 *
 * `tests/theme-picker.test.tsx` covers the component in jsdom, which is enough for the radio
 * semantics and the storage write. It is not enough for the two things that made this worth
 * an E2E, because both are properties of a *document* rather than of a component:
 *
 * 1. The choice survives a reload with no flash of the default. That path runs through an
 *    inline script (`components/theme/theme-bootstrap.ts`) that executes before hydration —
 *    jsdom never runs it, so a test there can assert the value was written and still be
 *    describing a product where reloading loses the theme.
 * 2. The change repaints without navigating. CLAUDE.md §6: "Preserve current screen and
 *    query state during theme changes." Only a real URL bar can say that a filtered board
 *    is still filtered afterwards.
 *
 * The label is clicked, never the input: the radio is visually hidden and the card sits over
 * it, so the input is not hit-testable — which is correct, and which a `.click()` on the
 * input would paper over. This is how a person selects a theme.
 */

const SYSTEM = "/system?section=themes";

test.describe("Theme picker", () => {
  test("applies a theme, keeps the URL, and survives a reload", async ({ page }) => {
    await page.goto(SYSTEM, { waitUntil: "networkidle" });

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(before, "the bootstrap stamps a theme before hydration").toBeTruthy();

    await page.getByRole("button", { name: "테마 바꾸기" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    // Whichever theme is not the current one — the assertion is that picking changes it,
    // not that any particular id wins.
    const target = await page.evaluate((current) => {
      const inputs = [
        ...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="radio"]'),
      ];
      return inputs.map((input) => input.value).find((value) => value !== current) ?? null;
    }, before);
    expect(target).not.toBeNull();

    const urlBefore = page.url();
    await page.locator(`label[for$="${target ?? ""}"]`).click();

    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe(target);
    expect(page.url(), "a theme change is not a navigation").toBe(urlBefore);
    await expect(drawer, "and it does not dismiss the drawer either").toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    expect(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "the chosen theme survives a reload",
    ).toBe(target);
  });

  test("closes on Escape and gives focus back", async ({ page }) => {
    await page.goto(SYSTEM, { waitUntil: "networkidle" });

    const trigger = page.getByRole("button", { name: "테마 바꾸기" });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Focus lands back where it came from, rather than on `<body>` at the top of the page.
    await expect(trigger).toBeFocused();
  });
});
