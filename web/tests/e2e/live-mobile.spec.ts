import { expect, test } from "@playwright/test";

/**
 * Mobile smoke test for the public site (runs in the `mobile` project: tests tagged @mobile).
 *   BASE_URL=https://sultan-records.vercel.app npx playwright test tests/e2e/live-mobile.spec.ts --project=mobile
 * Read-only: touches no data.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3400";

test("home on a phone: promo plays in-page, WhatsApp booking, menu without portal, no overflow @mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await expect(page.locator("header img[src*='logo']").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // Booking goes to the verified WhatsApp number with a prefilled Arabic message.
  const wa = page.locator('a[href^="https://wa.me/970598677477?text="]:visible').first();
  await expect(wa).toBeVisible();
  expect(decodeURIComponent((await wa.getAttribute("href"))!.split("text=")[1])).toMatch(/[؀-ۿ]/);

  // Menu: no client portal / tracking.
  await page.getByRole("button", { name: /القائمة|menu/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("بوابة العميل")).toHaveCount(0);
  await expect(dialog.locator('a[href^="/portal"], a[href^="/track"], a[href^="/login"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Promo: no iframe before tap; tap opens the dialog with the nocookie embed and YouTube plays.
  expect(await page.locator("iframe").count()).toBe(0);
  await page.getByRole("button", { name: /شاهد البرومو/ }).first().click();
  const frame = page.locator('[role="dialog"] iframe');
  await expect(frame).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/y0-ajKb7Umw/);
  const yt = page.frameLocator('[role="dialog"] iframe');
  const playing = await expect
    .poll(async () => yt.locator("video").evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.3).catch(() => false), { timeout: 30_000 })
    .toBe(true)
    .then(() => true, () => false);
  if (!playing) {
    await yt.locator(".ytp-large-play-button, button[aria-label*='Play']").first().click({ timeout: 10_000 }).catch(() => {});
    await expect.poll(async () => yt.locator("video").evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.3).catch(() => false), { timeout: 30_000 }).toBe(true);
  }
  await expect(page.getByRole("link", { name: /شاهد على YouTube/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=y0-ajKb7Umw");
  // On touch devices focus can be inside YouTube's iframe (Esc goes to YouTube), so close with the button.
  await page.getByRole("button", { name: "إغلاق الفيديو" }).click();
  await expect(page.locator('[role="dialog"] iframe')).toHaveCount(0);

  // Footer: phone readable LTR, no overflow.
  const tel = page.locator('footer a[href^="tel:"]').first();
  await expect(tel).toBeVisible();
  expect(await tel.evaluate((e) => e.getAttribute("dir") === "ltr" || !!e.closest('[dir="ltr"]') || !!e.querySelector('[dir="ltr"]'))).toBe(true);
  await page.screenshot({ path: "../docs/screenshots/live/live-home-mobile.png", fullPage: true });
  expect(errors.filter((e) => !/youtube|ytimg|googlevideo|doubleclick/i.test(e))).toEqual([]);
});

test("works page on a phone opens every video @mobile", async ({ page }) => {
  await page.goto(`${BASE}/work`, { waitUntil: "networkidle" });
  const cards = page.locator("main button:has(img[src*='i.ytimg.com'])");
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < n; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded();
    await cards.nth(i).click();
    await expect(page.locator('[role="dialog"] iframe')).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}/);
    await page.getByRole("button", { name: "إغلاق الفيديو" }).click();
    // The mobile menu dialog stays in the DOM (hidden); only the video dialog must be gone.
    await expect(page.locator('[role="dialog"]:has(iframe)')).toHaveCount(0);
  }
  await page.screenshot({ path: "../docs/screenshots/live/live-work-mobile.png", fullPage: true });
});
