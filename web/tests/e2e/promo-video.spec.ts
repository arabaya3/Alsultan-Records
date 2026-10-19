import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { PROMO_ASSETS } from "../../src/components/media/promo/promo-assets";

/**
 * Self-hosted studio promo (public/promo, content-hashed) — production build, LOCAL stack.
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/promo-video.spec.ts
 * Chromium is launched with --autoplay-policy=no-user-gesture-required so headless playback of the
 * click-started video is deterministic (a real click is a user gesture anyway).
 */
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots/promo");
const BASE = () => process.env.BASE_URL!;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const { landscape: L, portrait: P } = PROMO_ASSETS;

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

async function openAndPlay(page: Page, expected: typeof L) {
  expect(await page.locator("video").count(), "no <video> before the click").toBe(0);
  const trigger = page.locator("[data-hero-intro] [data-promo-trigger]");
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText("شاهد البرومو");
  await expect(trigger).toContainText("فيديو تعريفي · ٢٨ ث");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const labelled = await dialog.getAttribute("aria-labelledby");
  expect((await page.locator(`[id="${labelled}"]`).textContent())?.trim()).toBeTruthy();
  await expect(dialog.getByRole("link", { name: /YouTube/ })).toHaveCount(0);
  const video = dialog.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("src", expected.video);
  await expect(video).toHaveAttribute("poster", expected.coverJpg);
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("aria-label", /.+/);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => ({ t: v.currentTime > 1, playing: !v.paused })), { timeout: 15_000 })
    .toEqual({ t: true, playing: true });
  const box = (await video.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
  return { trigger, video, box };
}

async function closeWithEsc(page: Page, trigger: ReturnType<Page["locator"]>) {
  const handle = await page.locator("[data-promo-dialog] video").elementHandle();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("video").count(), "video element removed").toBe(0);
  expect(await handle!.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
}

test("desktop 1440: landscape file, plays, Esc closes + focus returns; covers load; screenshots", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const media: string[] = [];
  page.on("request", (r) => r.url().includes(".mp4") && media.push(r.url()));
  await page.goto(BASE() + "/", { waitUntil: "networkidle" });
  expect(media, "no mp4 requested before the click").toEqual([]);
  const cover = page.locator("[data-hero-intro] [data-promo-cover]");
  await expect.poll(() => cover.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  expect(await cover.evaluate((i: HTMLImageElement) => i.currentSrc)).toContain(L.coverWebp);
  await expect(page.locator("[data-hero-intro]")).toHaveAttribute("data-intro-state", "done", { timeout: 10_000 });
  await page.screenshot({ path: path.join(SHOTS, "home-1440.png") });
  const { trigger } = await openAndPlay(page, L);
  await expect(page.locator("[data-promo-dialog='landscape']")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "player-1440.png") });
  // Focus trap
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-promo-dialog]")))).toBe(true);
  }
  await closeWithEsc(page, trigger);
  await ctx.close();
});

test("mobile 390 (touch emulation): portrait file sized to the viewport, plays, closes", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.goto(BASE() + "/", { waitUntil: "networkidle" });
  const cover = page.locator("[data-hero-intro] [data-promo-cover]");
  await expect.poll(() => cover.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  expect(await cover.evaluate((i: HTMLImageElement) => i.currentSrc)).toContain(P.coverWebp);
  await expect(page.locator("[data-hero-intro]")).toHaveAttribute("data-intro-state", "done", { timeout: 10_000 });
  await page.screenshot({ path: path.join(SHOTS, "home-390.png") });
  const { trigger, box } = await openAndPlay(page, P);
  expect(Math.abs(box.width / box.height - 9 / 16)).toBeLessThan(0.02);
  await page.screenshot({ path: path.join(SHOTS, "player-390.png") });
  await closeWithEsc(page, trigger);
  await ctx.close();
});

test("static files: range request → 206, immutable cache, covers 200", async ({ request }) => {
  for (const a of [L, P]) {
    const r = await request.get(a.video, { headers: { Range: "bytes=0-1023" } });
    expect(r.status(), a.video).toBe(206);
    expect(r.headers()["content-range"]).toBe(`bytes 0-1023/${a.videoBytes}`);
    expect((await r.body()).length).toBe(1024);
    expect(r.headers()["content-type"]).toContain("video/mp4");
    expect(r.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    for (const c of [a.coverJpg, a.coverWebp]) expect((await request.get(c)).status(), c).toBe(200);
  }
});

test("home JSON-LD: VideoObject with absolute URLs", async ({ page }) => {
  await page.goto("/");
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const v = blocks.map((b) => JSON.parse(b)).find((d) => d["@type"] === "VideoObject");
  expect(v).toBeTruthy();
  expect(v.duration).toBe("PT28S");
  expect(v.uploadDate).toBe("2026-10-17");
  expect(v.contentUrl).toMatch(new RegExp(`^https?://[^/]+${L.video.replace(/\./g, "\\.")}$`));
  expect(v.thumbnailUrl[0]).toMatch(/^https?:\/\/.+\.jpg$/);
});

test("no overflow 360/390/768/1440/1920; reduced motion works; axe on /", async ({ browser }) => {
  for (const w of [360, 390, 768, 1440, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: w === 390 ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    await page.goto(BASE() + "/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `@${w}`).toBeLessThanOrEqual(0);
    if (w === 390) {
      await expect(page.locator("[data-hero-intro]")).toHaveAttribute("data-intro-state", "static");
      await page.locator("[data-promo-trigger]").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    if (w === 390 || w === 1440) {
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `@${w}`).toEqual([]);
    }
    await ctx.close();
  }
});

test("/work: promo item first, plays self-hosted; YouTube works still open the YouTube dialog", async ({ page }) => {
  await page.goto("/work", { waitUntil: "networkidle" });
  const first = page.locator("main [data-promo-trigger], main [data-youtube-card]").first();
  expect(await first.getAttribute("data-promo-trigger")).not.toBeNull();
  await expect(page.locator("[data-work-promo]")).toContainText("فيديو تعريفي بالاستوديو");
  expect(await page.locator("video, iframe").count()).toBe(0);
  await first.click();
  await expect(page.locator("[data-promo-dialog] video")).toHaveAttribute("src", L.video);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The former YouTube promo is a normal work in the grid now.
  await expect(page.locator('[data-video-grid] [data-youtube-card="y0-ajKb7Umw"]')).toHaveCount(1);
  const card = page.locator("[data-video-grid] [data-youtube-card]").first();
  const id = await card.getAttribute("data-youtube-card");
  await card.click();
  await expect(page.locator("[data-youtube-dialog] iframe")).toHaveAttribute("src", new RegExp(`youtube-nocookie\\.com/embed/${id}\\?`));
  await page.getByRole("button", { name: "إغلاق الفيديو" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Filtered views do not show the studio promo.
  const chip = page.locator("[data-cat-chip]:not([data-cat-chip=''])").first();
  if (await chip.count()) {
    await chip.click();
    await expect(page).toHaveURL(/cat=/);
    await expect(page.locator("[data-work-promo]")).toHaveCount(0);
  }
});
