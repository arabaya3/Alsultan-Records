import { expect, test, type Page } from "@playwright/test";
import { BASE, skipSiteIntro } from "./qa-helpers";

/**
 * Work-page category row (components/ui/ChipScroller.tsx): one scrollable row on phones, wrapped from 768 px.
 * The selected chip must be fully inside the row after EVERY change (load, click, back/forward, resize), the page
 * must not jump, focus must not be stolen, and motion respects prefers-reduced-motion.
 *   BASE_URL=http://localhost:3600 npx playwright test chip-scroller
 */
const row = (p: Page) => p.locator("[data-chip-scroller]").first();
async function activeFullyVisible(p: Page) {
  return row(p).evaluate((ul) => {
    const a = ul.querySelector("[aria-current=page]");
    if (!a) return false;
    const u = ul.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    return r.left >= u.left - 1 && r.right <= u.right + 1;
  });
}
const settle = (p: Page) => expect.poll(() => activeFullyVisible(p), { timeout: 3000 }).toBe(true);

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ page }) => skipSiteIntro(page));

  test("C1: deep link to the last category shows it inside the row; page does not jump", async ({ page }) => {
    await page.goto(`${BASE}/work`);
    const slugs = await page.locator("[data-cat-chip]").evaluateAll((as) => as.map((a) => a.getAttribute("data-cat-chip")));
    await page.goto(`${BASE}/work?cat=${slugs.at(-1)}`);
    await settle(page);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await expect(row(page)).toHaveAttribute("data-more-start", "true"); // more chips before it → start-edge fade
  });

  test("C2: click → back → forward keeps the selected chip visible each time", async ({ page }) => {
    await page.goto(`${BASE}/work`);
    const last = page.locator("[data-cat-chip]").last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await page.waitForURL(/cat=/);
    await settle(page);
    await page.goBack();
    await page.waitForURL((u) => !u.searchParams.has("cat"));
    await settle(page); // «الكل» (first chip) is back in view even though the row was scrolled to the end
    await page.goForward();
    await page.waitForURL(/cat=/);
    await settle(page);
  });

  test("C3: resize phone → desktop → phone: wraps on desktop, selected chip visible again on phone", async ({ page }) => {
    await page.goto(`${BASE}/work`);
    const slugs = await page.locator("[data-cat-chip]").evaluateAll((as) => as.map((a) => a.getAttribute("data-cat-chip")));
    await page.goto(`${BASE}/work?cat=${slugs.at(-1)}`);
    await settle(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await row(page).evaluate((ul) => getComputedStyle(ul).flexWrap)).toBe("wrap");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });

  test("C4: keyboard — every focused chip is fully visible; navigating keeps focus on the chosen chip", async ({ page }) => {
    await page.goto(`${BASE}/work`);
    const chips = page.locator("[data-cat-chip]");
    const n = await chips.count();
    await chips.first().focus();
    for (let i = 0; i < n; i++) {
      if (i) await page.keyboard.press("Tab");
      await expect
        .poll(() => page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          const u = e.closest("[data-chip-scroller]")?.getBoundingClientRect();
          const r = e.getBoundingClientRect();
          return !!u && e.hasAttribute("data-cat-chip") && r.left >= u.left - 1 && r.right <= u.right + 1;
        }))
        .toBe(true);
    }
    const slug = await page.evaluate(() => document.activeElement?.getAttribute("data-cat-chip"));
    await page.keyboard.press("Enter");
    await page.waitForURL(/cat=/);
    await settle(page);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-cat-chip"))).toBe(slug);
    expect(await page.evaluate(() => scrollY)).toBeLessThan(5);
  });
});

test("C5: reduced motion — row scrolls instantly (no smooth behavior)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/work`);
  const slugs = await page.locator("[data-cat-chip]").evaluateAll((as) => as.map((a) => a.getAttribute("data-cat-chip")));
  await page.goto(`${BASE}/work?cat=${slugs.at(-1)}`);
  expect(await activeFullyVisible(page)).toBe(true); // immediately, no polling
  await ctx.close();
});
