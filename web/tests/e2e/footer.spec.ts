import { expect, test } from "@playwright/test";
import path from "node:path";

/**
 * Footer + booking band layout, overflow, touch targets and the before/after screenshots.
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/footer.spec.ts --project=chromium
 */
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots/before-after");
const WIDTHS = [360, 390, 768, 1440, 1920];

test.describe.configure({ mode: "serial" });

test("footer height and booking band are compact on desktop", async ({ browser }) => {
  for (const width of [1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto("/", { waitUntil: "networkidle" });
    const footer = await page.locator("[data-site-footer]").boundingBox();
    const band = await page.locator("[data-booking-band]").boundingBox();
    test.info().annotations.push({ type: `footer@${width}`, description: `footer=${footer?.height}px band=${band?.height}px` });
    expect(footer!.height).toBeGreaterThanOrEqual(220);
    expect(footer!.height).toBeLessThanOrEqual(340);
    expect(band!.height).toBeLessThanOrEqual(130);
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
        .locator("[data-site-footer] a, [data-booking-band] a")
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
      await page.locator("[data-booking-band]").scrollIntoViewIfNeeded();
      const band = (await page.locator("[data-booking-band]").boundingBox())!;
      const foot = (await page.locator("[data-site-footer]").boundingBox())!;
      await page.screenshot({
        path: path.join(SHOTS, `after-footer-${width}.png`),
        fullPage: true,
        clip: { x: 0, y: band.y + (await page.evaluate(() => window.scrollY)), width, height: band.height + foot.height },
      });
    }
    await page.close();
  }
});
