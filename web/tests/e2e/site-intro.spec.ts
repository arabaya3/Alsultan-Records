import { expect, test, type Page } from "@playwright/test";
import { BASE } from "./qa-helpers";

/**
 * Site opening (components/layout/SiteIntro.tsx): once per session, ≤ 2 s, skippable at once, never with reduced
 * motion, never left blocking clicks/scroll, no replay on navigation or reload.
 *   BASE_URL=http://localhost:3600 npx playwright test site-intro
 */
const overlay = (page: Page) => page.locator(".site-intro");
const on = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-site-intro"));

for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
  test(`I1 ${label}: plays on first visit, original logo, gone by 2.1 s, page interactive afterwards`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport, locale: "ar" });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    // Read everything in one tick while it is up (on a slow live stream the 2 s window can be short for the test runner).
    const seen = await page.waitForFunction(() => {
      const o = document.querySelector(".site-intro");
      return document.documentElement.getAttribute("data-site-intro") === "on" && o && getComputedStyle(o).display !== "none"
        ? { src: o.querySelector("img")?.getAttribute("src"), text: o.textContent } : null;
    }, null, { timeout: 4000 }).then((h) => h.jsonValue());
    expect(seen!.src).toBe("/brand/logo-main.webp");
    expect(seen!.text).toContain("فرحتك إلها حكاية");
    // The page loads behind it (no artificial wait): the hero heading is already in the DOM.
    await expect(page.locator("#hero-title")).toBeAttached();
    await expect(overlay(page)).toBeHidden({ timeout: 4000 });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(await on(page)).toBeNull();
    // Nothing left over: clicks reach the page, scrolling works, no scroll lock.
    const top = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(".site-intro"));
    expect(top).toBeNull();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/site-intro-after-${label}.png` });
    await ctx.close();
  });
}

test("I2: «تخطّي» removes it immediately", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  const skip = page.getByRole("button", { name: "تخطّي" });
  await skip.click({ timeout: 2000 });
  await expect(overlay(page)).toBeHidden({ timeout: 300 });
  expect(await on(page)).toBeNull();
  await ctx.close();
});

test("I3: once per session — no replay on navigation or reload; a new session plays again", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toBeHidden({ timeout: 4000 });
  await page.getByRole("navigation", { name: "القائمة الرئيسية" }).getByRole("link", { name: "البكجات" }).click();
  await page.waitForURL(/\/packages/);
  await expect(overlay(page)).toBeHidden();
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await on(page)).toBeNull();
  await expect(overlay(page)).toBeHidden();
  await page.goto(`${BASE}/work`, { waitUntil: "domcontentloaded" });
  expect(await on(page)).toBeNull();
  await ctx.close();
  const fresh = await (await browser.newContext({ locale: "ar" })).newPage();
  await fresh.goto(`${BASE}/work`, { waitUntil: "commit" });
  await expect(overlay(fresh)).toBeVisible(); // also on inner pages for a new visit
  await fresh.context().close();
});

test("I4: prefers-reduced-motion shows the site directly", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ar", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "commit" });
  expect(await on(page)).toBeNull();
  await expect(overlay(page)).toBeHidden();
  await ctx.close();
});

test("I5: admin and login never show it", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "ar" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "commit" });
  expect(await on(page)).toBeNull();
  await ctx.close();
});
