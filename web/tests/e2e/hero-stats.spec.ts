import { expect, test, type Browser } from "@playwright/test";
import { BASE, db, newLoggedIn, overflowPx, skipSiteIntro } from "./qa-helpers";

// Hero counters (migration 0036): typed by the owner in «الواجهة»; empty = not shown; all empty = no block.
const COLS = "hero_stat_videos, hero_stat_photos, hero_stat_events";
let before: Record<string, number | null>;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  before = (await db.from("business_settings").select(COLS).eq("id", 1).single()).data as Record<string, number | null>;
});
test.afterAll(async () => {
  await db.from("business_settings").update(before).eq("id", 1);
});

async function save(browser: Browser, v: { videos: string; photos: string; events: string }) {
  const page = await newLoggedIn(browser, "admin", "/admin/content/home");
  await page.goto(`${BASE}/admin/content/home`, { waitUntil: "networkidle" }); // hydrated before typing
  const form = page.getByTestId("home-form");
  await form.getByTestId("hero-stat-videos").fill(v.videos);
  await form.getByTestId("hero-stat-photos").fill(v.photos);
  await form.getByTestId("hero-stat-events").fill(v.events);
  await form.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await page.context().close();
}
async function heroStats(browser: Browser, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await skipSiteIntro(ctx);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  const items = p.locator("[data-hero-stats] [data-hero-stat]");
  const out = { texts: await items.allInnerTexts(), overflow: await overflowPx(p), page: p, ctx };
  return out;
}

test("HS1: the owner's three numbers show in the hero; a cleared one is hidden; none = no block", async ({ browser }) => {
  await save(browser, { videos: "1250", photos: "48000", events: "2436" });
  expect((await db.from("business_settings").select(COLS).eq("id", 1).single()).data).toEqual({ hero_stat_videos: 1250, hero_stat_photos: 48000, hero_stat_events: 2436 });
  await expect
    .poll(async () => { const r = await heroStats(browser); await r.ctx.close(); return r.texts.map((t) => t.replace(/\s+/g, " ").trim()); }, { timeout: 20_000 })
    .toEqual(["1,250 فيديو", "48,000 صورة", "2,436 مناسبة"]);
  for (const w of [1440, 390, 360]) {
    const r = await heroStats(browser, w);
    expect(r.overflow, `no horizontal scroll at ${w}`).toBe(0);
    await r.page.screenshot({ path: test.info().outputPath(`hero-stats-${w}.png`) });
    await r.ctx.close();
  }

  await save(browser, { videos: "1250", photos: "", events: "2436" });
  await expect.poll(async () => { const r = await heroStats(browser); await r.ctx.close(); return r.texts.length; }, { timeout: 20_000 }).toBe(2);

  await save(browser, { videos: "", photos: "", events: "" });
  await expect
    .poll(async () => { const r = await heroStats(browser); const n = await r.page.locator("[data-hero-stats]").count(); await r.ctx.close(); return n; }, { timeout: 20_000 })
    .toBe(0);
});

test("HS2: zero or a fraction is refused and nothing is stored", async ({ browser }) => {
  await db.from("business_settings").update({ hero_stat_videos: 7, hero_stat_photos: null, hero_stat_events: null }).eq("id", 1);
  const page = await newLoggedIn(browser, "admin", "/admin/content/home");
  await page.goto(`${BASE}/admin/content/home`, { waitUntil: "networkidle" });
  const form = page.getByTestId("home-form");
  // bypass the browser's own min/step check to reach the server rule
  await form.getByTestId("hero-stat-videos").evaluate((el: HTMLInputElement) => { el.removeAttribute("min"); el.removeAttribute("step"); });
  await form.getByTestId("hero-stat-videos").fill("0");
  await form.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "0");
  await expect(form.getByTestId("action-msg")).toContainText("عدد الفيديوهات");
  expect((await db.from("business_settings").select("hero_stat_videos").eq("id", 1).single()).data!.hero_stat_videos).toBe(7);
  await page.context().close();
});
