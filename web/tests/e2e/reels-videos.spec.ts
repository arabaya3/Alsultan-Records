import { expect, test } from "@playwright/test";
import { BASE, skipSiteIntro } from "./qa-helpers";

/** Reels mode on the videos tab. Needs the app and this run on REELS_VIEWER=1. Real autoplay needs a real phone. */
test.skip(process.env.REELS_VIEWER !== "1", "reels mode is off");

test("videos tab: reels mode opens from the button, switching keeps one player and changes the reel", async ({ page }) => {
  await skipSiteIntro(page);
  await page.goto(`${BASE}/work`);
  const open = page.locator("[data-reels-open]");
  await expect(open).toHaveText("تشغيل بوضع الريلز");
  await open.click();
  const viewer = page.locator("[data-reels-viewer]");
  await expect(viewer).toBeVisible();
  const frame = viewer.locator("[data-reels-player] iframe");
  await expect(frame).toHaveCount(1);
  const reels = await viewer.locator("[data-reel]").count();
  expect(reels).toBeGreaterThan(12); // every video, not only the first loaded page

  await frame.evaluate((f) => f.setAttribute("data-same-element", "1"));
  const src = await frame.getAttribute("src");
  const first = new URL(page.url()).searchParams.get("reel");
  await page.locator("[data-reels-next]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("reel")).not.toBe(first);
  await expect(viewer.locator("iframe[data-same-element]")).toHaveCount(1);
  expect(await frame.getAttribute("src")).toBe(src);

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});
