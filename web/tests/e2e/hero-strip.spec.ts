import { expect, test } from "@playwright/test";
import { skipSiteIntro } from "./qa-helpers";

/** Home hero: each thumbnail under the video opens that video in place, and focus comes back to it. */
test("hero thumbnails open their video", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await skipSiteIntro(page);
  await page.goto("/");
  const thumbs = page.locator("[data-hero-strip]");
  test.skip((await thumbs.count()) < 3, "fewer than 3 published works");
  const first = thumbs.first();
  const id = await first.getAttribute("data-hero-strip");
  expect(await page.locator("iframe").count()).toBe(0);
  await first.click();
  await expect(page.locator("[data-youtube-dialog] iframe")).toHaveAttribute("src", new RegExp(`embed/${id}\?`));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(first).toBeFocused();
});
