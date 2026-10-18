import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Production empty states.
 *
 * Public content is fetched SERVER-SIDE ('use cache'), so browser route interception cannot
 * empty it. Two modes:
 *  - EMPTY_STATE=1: the app was built + started with NEXT_PUBLIC_SUPABASE_URL pointing at
 *    tests/e2e/stubs/empty-supabase.mjs (every REST read returns []). Asserts the empty layout.
 *  - otherwise: runs against the current local DB and asserts the always-present essentials.
 *
 *   BASE_URL=http://localhost:3700 [EMPTY_STATE=1] npx playwright test tests/e2e/empty-states.spec.ts
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3700";
const EMPTY = process.env.EMPTY_STATE === "1";
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots");

async function settle(page: Page) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 400) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

async function essentials(page: Page) {
  const header = page.locator("header");
  await expect(header.locator('img[src*="logo-main"], img[srcset*="logo-main"]').first()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("فرحتك إلها حكاية");
  await expect(page.locator("main a[href='/book'], main a[href^='https://wa.me/']").first()).toBeVisible(); // booking is via WhatsApp (approved scope)
  await expect(page.getByRole("heading", { name: "الخدمات" })).toBeVisible();
  expect(await page.locator("#services-title ~ * li, section[aria-labelledby='services-title'] ol > li").count()).toBeGreaterThan(0);
  // A way to reach the studio: the footer shows WhatsApp/phone when they are set (it falls back to /contact
  // only when they are not), and the header menu always links /contact.
  await expect(page.locator("header a[href='/contact'], footer a[href='/contact'], footer a[href^='https://wa.me/'], footer a[href^='tel:']").first()).toBeAttached();
  await expect(page.locator("[data-placeholder]")).toHaveCount(0);
  await expect(page.getByText("صورة مؤقتة")).toHaveCount(0);
}

async function keyboardReaches(page: Page, hrefs: string[]) {
  const seen = new Set<string>();
  for (let i = 0; i < 60 && hrefs.some((h) => !seen.has(h)); i++) {
    await page.keyboard.press("Tab");
    const href = await page.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute?.("href") ?? "");
    if (href) seen.add(href);
  }
  for (const h of hrefs) expect(seen.has(h), `keyboard reaches ${h}`).toBe(true);
}

async function noOverflow(page: Page, url: string) {
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${url} overflow at ${width}`).toBeLessThanOrEqual(0);
  }
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.describe("empty production state (stub Supabase)", () => {
  test.skip(!EMPTY, "set EMPTY_STATE=1 with the app pointed at the empty stub");

  test("home: intentional hero, no showcase, services lead", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await essentials(page);
    await expect(page.locator("[data-hero-mark] img")).toBeVisible();
    await expect(page.locator("#work-title")).toHaveCount(0);
    await expect(page.locator("#reviews-title")).toHaveCount(0);
    await expect(page.locator("main a[href='/work']")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "كيف نشتغل" })).toBeVisible();
    await expect(page.locator("#cta-title")).toBeVisible();
    await keyboardReaches(page, ["/book", "/contact", "/services"]);
    await settle(page);
    await page.screenshot({ path: path.join(SHOTS, "empty-home-1440.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await essentials(page);
    await settle(page);
    await page.screenshot({ path: path.join(SHOTS, "empty-home-390.png"), fullPage: true });
  });

  test("work: honest message with book/contact, no grid", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/work`, { waitUntil: "networkidle" });
    await expect(page.getByText("نجهّز معرض الأعمال")).toBeVisible();
    await expect(page.locator("main a[href='/book'], main a[href^='https://wa.me/']").first()).toBeVisible(); // booking is via WhatsApp (approved scope)
    await expect(page.locator("main a[href='/contact']").first()).toBeVisible();
    await expect(page.locator("main a[href^='/work/']")).toHaveCount(0);
    await expect(page.locator("[data-placeholder]")).toHaveCount(0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, "empty-work-1440.png"), fullPage: true });
  });

  test("no horizontal overflow 320-1440", async ({ page }) => {
    await noOverflow(page, "/");
    await noOverflow(page, "/work");
  });
});

test.describe("current local DB", () => {
  test.skip(EMPTY, "runs against the real local DB");

  test("home essentials + screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await essentials(page);
    await keyboardReaches(page, ["/book", "/services"]);
    await settle(page);
    await page.screenshot({ path: path.join(SHOTS, "home-1440-v3.png"), fullPage: true });
  });

  test("no horizontal overflow 320-1440", async ({ page }) => {
    await noOverflow(page, "/");
  });
});
