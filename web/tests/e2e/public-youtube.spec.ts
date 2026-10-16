import { expect, test, type Page } from "@playwright/test";

/**
 * YouTube player + WhatsApp-only booking on the public site (production build, LOCAL stack).
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/public-youtube.spec.ts --project=chromium
 * Playback is proven inside the YouTube iframe (video.currentTime advances). Headless Chromium
 * can be refused by YouTube; set YT_HEADED=1 to rerun headed. If playback is refused the test
 * reports it explicitly rather than passing on a thumbnail alone.
 */
const PROMO = "y0-ajKb7Umw";
const WA = /^https:\/\/wa\.me\/970598677477\?text=/;
const PUBLIC = ["/", "/work", "/services", "/about", "/contact", "/book", "/faq", "/privacy", "/terms"];

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"], headless: !process.env.YT_HEADED } });

async function playbackState(page: Page) {
  const frame = page.frameLocator("[data-youtube-dialog] iframe");
  const video = frame.locator("video");
  await video.waitFor({ state: "attached", timeout: 30_000 });
  // Autoplay=1 in the embed URL; if the player still waits for a gesture, press its play button.
  for (let i = 0; i < 20; i++) {
    const t = await video.evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused }));
    if (t.t > 0.5 && !t.paused) return t;
    if (i === 4) await frame.locator(".ytp-large-play-button, .ytp-play-button").first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  return video.evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused }));
}

test("no iframe before click; promo dialog opens, plays, closes and returns focus", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  expect(await page.locator("iframe").count(), "no iframe on load (no autoplay)").toBe(0);

  const trigger = page.locator("[data-promo-trigger]");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const labelled = await dialog.getAttribute("aria-labelledby");
  expect(labelled && (await page.locator(`[id="${labelled}"]`).textContent())?.trim()).toBeTruthy();

  const iframe = dialog.locator("iframe");
  await expect(iframe).toHaveAttribute("src", new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${PROMO}\\?`));
  await expect(iframe).toHaveAttribute("allowfullscreen", "");
  await expect(iframe).toHaveAttribute("allow", /encrypted-media/);
  await expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  await expect(iframe).toHaveAttribute("title", /.+/);
  await expect(dialog.getByRole("link", { name: "شاهد على YouTube" })).toHaveAttribute(
    "href",
    `https://www.youtube.com/watch?v=${PROMO}`,
  );
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  const state = await playbackState(page);
  test.info().annotations.push({ type: "playback", description: JSON.stringify(state) });
  expect(state.paused, "YouTube <video> inside the iframe is playing").toBe(false);
  expect(state.t).toBeGreaterThan(0.5);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("iframe").count()).toBe(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("dialog traps keyboard focus", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-promo-trigger]").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "إغلاق الفيديو" })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-youtube-dialog]")))).toBe(true);
  }
  await page.keyboard.press("Escape");
});

test("works grid on /work opens each video", async ({ page }) => {
  await page.goto("/work", { waitUntil: "networkidle" });
  const cards = page.locator("[data-youtube-card]");
  const n = await cards.count();
  test.info().annotations.push({ type: "work-cards", description: String(n) });
  expect(n).toBeGreaterThanOrEqual(2);
  expect(await page.locator(`[data-youtube-card="${PROMO}"]`).count()).toBe(1);
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const id = await card.getAttribute("data-youtube-card");
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.locator("[data-youtube-dialog] iframe")).toHaveAttribute(
      "src",
      new RegExp(`youtube-nocookie\\.com/embed/${id}\\?`),
    );
    await page.getByRole("button", { name: "إغلاق الفيديو" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(card).toBeFocused();
  }
});

test("home works grid shows non-promo videos and opens them", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator("#work-title").locator("xpath=ancestor::section").locator("[data-youtube-card]");
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  expect(await page.locator(`section [data-youtube-card="${PROMO}"]`).count()).toBe(0);
  await cards.first().click();
  await expect(page.locator("[data-youtube-dialog] iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\//);
  await page.keyboard.press("Escape");
});

test("WhatsApp CTAs use wa.me with Arabic prefilled text", async ({ page }) => {
  for (const route of ["/", "/book", "/contact", "/work", "/services", "/about", "/faq"]) {
    await page.goto(route);
    const ctas = page.locator("a[data-whatsapp-cta]");
    expect(await ctas.count(), `${route} has a WhatsApp CTA`).toBeGreaterThan(0);
    for (const href of await ctas.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).toMatch(WA);
      const text = decodeURIComponent(new URL(href).searchParams.get("text") ?? "");
      expect(text).toMatch(/[؀-ۿ]/);
    }
    for (const a of await ctas.all()) {
      await expect(a).toHaveAttribute("target", "_blank");
      await expect(a).toHaveAttribute("rel", /noopener/);
    }
  }
});

test("/book is WhatsApp-only with a tel: link; /track redirects permanently", async ({ page, request }) => {
  await page.goto("/book");
  expect(await page.locator("main form, main input, main textarea, main select").count()).toBe(0);
  await expect(page.locator('main a[href^="tel:+970598677477"]')).toBeVisible();
  const res = await request.get("/track", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers()["location"]).toMatch(/\/book$/);
});

test("no portal/track/form/registration on public pages", async ({ page }) => {
  for (const route of PUBLIC) {
    await page.goto(route);
    const body = await page.locator("body").innerText();
    expect(body, route).not.toContain("بوابة العميل");
    expect(body, route).not.toContain("تابع طلبك");
    expect(body, route).not.toMatch(/إنشاء حساب|رابط (الدخول|سحري)|سجّل الدخول/);
    expect(await page.locator('a[href^="/portal"], a[href^="/track"], a[href^="/login"]').count(), route).toBe(0);
    expect(await page.locator("main form").count(), `${route} form`).toBe(0);
  }
});

test("reduced motion: content visible with no transforms; dialog still works", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL + "/");
  await expect(page.locator("#hero-title")).toBeVisible();
  const opacity = await page.locator("#hero-title [data-reveal]").first().evaluate((e) => getComputedStyle(e).opacity);
  expect(opacity).toBe("1");
  await page.locator("[data-promo-trigger]").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ctx.close();
});
