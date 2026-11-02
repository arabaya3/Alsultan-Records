import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PROMO_ASSETS } from "../../src/components/media/promo/promo-assets";

/**
 * Self-hosted studio promo (public/promo, content-hashed) — production build, LOCAL stack.
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/promo-video.spec.ts
 * Chromium is launched with --autoplay-policy=no-user-gesture-required so headless playback of the
 * click-started video is deterministic (a real click is a user gesture anyway).
 */
const BASE = () => process.env.BASE_URL!;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const { landscape: L, portrait: P } = PROMO_ASSETS;

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

test("/about: no studio promo section", async ({ page }) => {
  await page.goto(BASE() + "/about", { waitUntil: "networkidle" });
  await expect(page.locator("[data-promo-trigger]")).toHaveCount(0);
  await expect(page.locator("#about-promo-title")).toHaveCount(0);
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

test("home hero: the newest YouTube video, nothing from YouTube or the promo loads before the click", async ({ page }) => {
  const media: string[] = [];
  page.on("request", (r) => /\.mp4|youtube\.com\/embed|youtube-nocookie/.test(r.url()) && media.push(r.url()));
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-hero-intro] [data-promo-trigger]")).toContainText("شاهد أحدث أعمالنا");
  expect(media).toEqual([]);
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(blocks.map((b) => JSON.parse(b)).find((d) => d["@type"] === "VideoObject")).toBeUndefined();
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

test("/work: no studio promo on the videos tab; YouTube works open the YouTube dialog", async ({ page }) => {
  await page.goto("/work", { waitUntil: "networkidle" });
  await expect(page.locator("main [data-promo-trigger]")).toHaveCount(0);
  expect(await page.locator("video, iframe").count()).toBe(0);
  const card = page.locator("[data-video-grid] [data-youtube-card]").first();
  const id = await card.getAttribute("data-youtube-card");
  await card.click();
  await expect(page.locator("[data-youtube-dialog] iframe")).toHaveAttribute("src", new RegExp(`youtube-nocookie\\.com/embed/${id}\\?`));
  await page.getByRole("button", { name: "إغلاق الفيديو" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
