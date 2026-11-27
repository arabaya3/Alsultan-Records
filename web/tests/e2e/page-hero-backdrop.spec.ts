import { expect, test } from "@playwright/test";
import { BASE, skipSiteIntro } from "./qa-helpers";

/**
 * Inner-page hero backdrop (PageHero → RotatingBackdrop): the published covers fade in turn only while the hero is on
 * screen; scrolled away, no further cover is loaded. Read-only; relies on the seeded published albums (two covers or
 * more). Run: BASE_URL=http://localhost:3400 npx playwright test page-hero-backdrop
 */
const area = "[data-rotating-backdrop-area]";
const rotated = "img[data-rotating-backdrop]";

test("BD1: off screen the backdrop loads no other cover; back on screen it fades to the next one", async ({ page }) => {
  test.setTimeout(90_000);
  await skipSiteIntro(page);
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto(`${BASE}/privacy`);
  await expect(page.locator(area), "this page rotates the published covers").toHaveCount(1);
  await expect(page.locator(area)).toHaveAttribute("data-rotating-backdrop-area", "1");

  const covers: string[] = [];
  page.on("request", (r) => {
    if (/\/p\/[0-9a-f-]{36}\/display$/.test(r.url())) covers.push(r.url());
  });
  // Scrolled away before the first turn (8 s).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator(area)).toHaveAttribute("data-rotating-backdrop-area", "0");
  await page.waitForTimeout(18_000); // two turns
  await expect(page.locator(rotated)).toHaveCount(0);
  expect(covers, "no cover requested while the hero is off screen").toEqual([]);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(area)).toHaveAttribute("data-rotating-backdrop-area", "1");
  await expect(page.locator(rotated)).toHaveCount(1, { timeout: 15_000 });
  expect(covers.length).toBeGreaterThan(0);
});
