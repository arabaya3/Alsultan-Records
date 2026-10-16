import { expect, test } from "@playwright/test";
import path from "node:path";
import { isKnownLocalHttpsArtifact } from "./qa-helpers";

/**
 * Public-site smoke: screenshots, horizontal overflow, console errors.
 * Run against a dev server:  BASE_URL=http://localhost:3100 npx playwright test tests/e2e/public.spec.ts
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots");
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];
const PAGES = ["/", "/work", "/services", "/about", "/contact", "/book", "/faq", "/privacy", "/terms"];

async function scrollThrough(page: import("@playwright/test").Page) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 400) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

test.describe.configure({ mode: "serial" });

test("homepage screenshots at 1440 and 390", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 1000 : 844 } });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // let entrance motion settle
    if (width !== 1440) await scrollThrough(page);
    await page.screenshot({ path: path.join(SHOTS, `home-${width}.png`), fullPage: width !== 1440 });
    if (width === 1440) {
      await scrollThrough(page);
      await page.screenshot({ path: path.join(SHOTS, `home-${width}-full.png`), fullPage: true });
    }
    await page.close();
  }
});

for (const route of PAGES) {
  test(`no overflow or console errors: ${route}`, async ({ browser }) => {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !isKnownLocalHttpsArtifact(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${route} @${width}px horizontal overflow`).toBeLessThanOrEqual(0);
      expect(errors, `${route} @${width}px console errors`).toEqual([]);
      await page.close();
    }
  });
}

test("html is rtl arabic and the original logo is used", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  const src = await page.locator("header img").first().getAttribute("src");
  expect(src).toContain("logo-main.webp");
});

test("mobile menu traps focus and closes on Escape", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/`);
  const toggle = page.getByRole("button", { name: "فتح القائمة" });
  await toggle.click();
  const dialog = page.getByRole("dialog", { name: "القائمة" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => {
    const a = document.activeElement;
    return Boolean(a?.closest('[role="dialog"]') || a?.getAttribute("aria-controls"));
  });
  expect(inside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "فتح القائمة" })).toBeFocused();
  await page.close();
});

test("/book is a WhatsApp page, not a form", async ({ page }) => {
  await page.goto(`${BASE}/book`);
  expect(await page.locator("main form, main input").count()).toBe(0);
  await expect(page.locator("main a[data-whatsapp-cta]")).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
});
