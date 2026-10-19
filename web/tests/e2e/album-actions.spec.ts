import { expect, test } from "@playwright/test";
import { BASE, skipSiteIntro } from "./qa-helpers";

/**
 * Album page actions live in the hero (AlbumActions → window event → AlbumGallery): the slideshow opens from the
 * hero button, Esc closes it, focus returns to that button, and no scroll lock is left behind.
 *   BASE_URL=http://localhost:3600 npx playwright test album-actions
 */
const ALBUM = "/work/albums/wedding-dawood-nairat-2026";

for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]] as const) {
  test(`AA ${label}: hero «عرض الشرائح» opens the slideshow; Esc closes; focus returns; no scroll lock`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport, locale: "ar" });
    const page = await ctx.newPage();
    await skipSiteIntro(page);
    await page.goto(`${BASE}${ALBUM}`);
    const actions = page.locator("[data-album-actions]");
    await expect(actions).toHaveCount(1); // rendered once, in the hero (not duplicated above the grid)
    expect(await actions.evaluate((el) => !!el.closest(".hero-flow"))).toBe(true);
    // Back link keeps its accessible name even when it is icon-only on phones.
    await expect(actions.getByRole("link", { name: "العودة للألبومات" })).toBeVisible();
    await expect(actions.getByRole("button", { name: /مشاركة/ })).toBeVisible();

    const open = actions.getByRole("button", { name: "عرض الشرائح" });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => [getComputedStyle(document.body).overflow, getComputedStyle(document.documentElement).overflow])).not.toContain("hidden");
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);

    // Opening a single photo from the grid still works (gallery state not tied to the hero).
    await page.locator("[data-photo-grid] li").first().locator("button, a").first().click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await ctx.close();
  });
}
