import { expect, test } from "@playwright/test";
import path from "node:path";

/**
 * Compact footer (cinematic redesign: the booking band was removed by design), overflow, touch targets, screenshots.
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/footer.spec.ts --project=chromium
 */
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots/before-after");
const WIDTHS = [360, 390, 768, 1440, 1920];

test.describe.configure({ mode: "serial" });

test("footer is compact on desktop", async ({ browser }) => {
  for (const width of [1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto("/", { waitUntil: "networkidle" });
    const footer = await page.locator("[data-site-footer]").boundingBox();
    test.info().annotations.push({ type: `footer@${width}`, description: `footer=${footer?.height}px` });
    // Compact footer (one band + links row); still a real footer, not a sliver.
    expect(footer!.height).toBeGreaterThanOrEqual(120);
    expect(footer!.height).toBeLessThanOrEqual(340);
    await expect(page.locator("[data-booking-band]")).toHaveCount(0); // no big booking CTA on every page
    // Full-width background, content in the container.
    expect(footer!.width).toBe(width);
    await page.close();
  }
});

test("no horizontal overflow; footer links are >=44px tall on mobile", async ({ browser }) => {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 1024 });
    for (const route of ["/", "/work", "/book", "/contact"]) {
      await page.goto(route, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} @${width}`).toBeLessThanOrEqual(0);
    }
    if (width < 768) {
      const heights = await page
        .locator("[data-site-footer] a")
        .evaluateAll((as) => as.map((a) => [a.textContent?.trim(), a.getBoundingClientRect().height] as const));
      for (const [label, h] of heights) expect(h, `touch target "${label}" @${width}`).toBeGreaterThanOrEqual(44);
      const footer = await page.locator("[data-site-footer]").boundingBox();
      test.info().annotations.push({ type: `footer@${width}`, description: `${footer?.height}px` });
    }
    await page.close();
  }
});

test("footer content: groups, ltr phone, no duplicates, no portal/track", async ({ page }) => {
  await page.goto("/");
  const f = page.locator("[data-site-footer]");
  await expect(f.locator('a[href^="tel:"] [dir="ltr"]')).toHaveText("+970598677477");
  const hrefs = await f.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  for (const h of ["/work", "/services", "/about", "/book", "/privacy", "/terms"]) expect(hrefs).toContain(h);
  expect(hrefs.some((h) => h?.startsWith("/portal") || h?.startsWith("/track"))).toBe(false);
});

test("after screenshots", async ({ browser }) => {
  for (const width of [1440, 390, 360, 768, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: width >= 1440 ? 900 : 844 } });
    await page.goto("/", { waitUntil: "networkidle" });
    // Scroll through so on-scroll reveals settle, then back to the top.
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 500) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `after-home-${width}.png`), fullPage: true });
    if (width === 1440) await page.screenshot({ path: path.join(SHOTS, "after-home-1440-fold.png") });
    if (width === 1440 || width === 390) {
      await page.locator("[data-site-footer]").screenshot({ path: path.join(SHOTS, `after-footer-${width}.png`) });
    }
    await page.close();
  }
});
