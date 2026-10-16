import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { anon } from "./qa-helpers";

/**
 * Works gallery (videos): categories, URL state, pagination, dialog + video page, home selection.
 * LOCAL STACK + PRODUCTION BUILD:
 *   npm run build && npx next start -p 3600
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/gallery.spec.ts --project=chromium
 * Expectations are derived from the database (anon key = exactly what the public can see), so the
 * spec stays valid as videos/categories are curated.
 */
const SHOTS = path.resolve(__dirname, "../../../docs/screenshots/gallery");
test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"], headless: !process.env.YT_HEADED } });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Cat = { id: string; slug: string; title: string; sort_order: number };
type Vid = { id: string; youtube_id: string; title: string; is_promo: boolean; sort_order: number };
type Link = { video_id: string; category_id: string; is_primary: boolean };

let cats: Cat[] = [];
let vids: Vid[] = [];
let links: Link[] = [];

test.beforeAll(async () => {
  const sb = anon();
  const [c, v, l] = await Promise.all([
    sb.from("video_categories").select("id, slug, title, sort_order").order("sort_order"),
    sb.from("showcase_videos").select("id, youtube_id, title, is_promo, sort_order").order("is_promo", { ascending: false }).order("sort_order"),
    sb.from("showcase_video_categories").select("video_id, category_id, is_primary"),
  ]);
  cats = (c.data ?? []) as Cat[];
  vids = (v.data ?? []) as Vid[];
  links = (l.data ?? []) as Link[];
  expect(vids.length, "published videos in the local stack").toBeGreaterThan(9);
  expect(cats.length).toBeGreaterThan(1);
});

const videosIn = (slug: string) => {
  const cat = cats.find((c) => c.slug === slug)!;
  const ids = new Set(links.filter((l) => l.category_id === cat.id).map((l) => l.video_id));
  return vids.filter((v) => ids.has(v.id));
};
const nonEmptyCats = () => cats.filter((c) => videosIn(c.slug).length > 0);
async function cardIds(page: Page) {
  // The grid streams in (Suspense); wait for it before reading.
  await page.locator("[data-video-grid]:visible [data-youtube-card]").first().waitFor();
  return page.locator("[data-video-grid]:visible [data-youtube-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-youtube-card")));
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).exclude("iframe").analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("chips: «الكل» + only categories with ≥1 published video; filter is in the URL (refresh + back)", async ({ page }) => {
  await page.goto("/work");
  const chips = page.locator("nav[aria-label='تصنيفات الفيديو'] a");
  const labels = (await chips.allInnerTexts()).map((t) => t.replace(/[\d٠-٩]+/g, "").trim());
  expect(labels[0]).toBe("الكل");
  expect(labels.slice(1)).toEqual(nonEmptyCats().map((c) => c.title));
  await expect(page.locator("[data-cat-chip='']:visible")).toHaveAttribute("aria-current", "page");

  const target = nonEmptyCats()[1] ?? nonEmptyCats()[0];
  await page.locator(`[data-cat-chip='${target.slug}']:visible`).click();
  await expect(page).toHaveURL(new RegExp(`/work\\?cat=${target.slug}$`));
  await expect(page.locator(`[data-cat-chip='${target.slug}']:visible`)).toHaveAttribute("aria-current", "page");
  const expected = videosIn(target.slug).map((v) => v.youtube_id);
  const shown = await cardIds(page);
  expect(new Set(shown)).toEqual(new Set(expected.slice(0, 9)));
  expect(await page.locator("[data-promo-trigger], iframe").count()).toBe(0);

  await page.reload();
  expect(new Set(await cardIds(page))).toEqual(new Set(shown));
  await expect(page.locator(`[data-cat-chip='${target.slug}']:visible`)).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.locator("[data-cat-chip='']:visible")).toHaveAttribute("aria-current", "page");
  test.info().annotations.push({ type: "filter", description: `${target.slug}: ${shown.length} cards` });
});

test("unknown category shows an honest empty state; bad params are ignored", async ({ page }) => {
  const res = await page.goto("/work?cat=does-not-exist&page=abc");
  expect(res?.status()).toBe(200);
  await expect(page.getByText("لا توجد فيديوهات في هذا التصنيف")).toBeVisible();
});

test("pagination: 9 per page, «تحميل المزيد» keeps URL state, no iframe in the grid", async ({ page }) => {
  const all = vids.filter((v) => !v.is_promo);
  await page.goto("/work");
  expect(await page.locator("iframe").count()).toBe(0);
  expect((await cardIds(page)).length).toBe(Math.min(9, all.length));
  await page.locator("[data-load-more]").click();
  await expect(page).toHaveURL(/\/work\?page=2$/);
  await expect(page.locator("[data-video-grid]:visible [data-youtube-card]")).toHaveCount(Math.min(18, all.length));
  expect(await page.locator("iframe").count()).toBe(0);
  await page.reload();
  await expect(page.locator("[data-video-grid]:visible [data-youtube-card]")).toHaveCount(Math.min(18, all.length));
  if (all.length <= 18) await expect(page.locator("[data-load-more]")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator("[data-video-grid]:visible [data-youtube-card]")).toHaveCount(9);
});

test("titles are the original DB titles verbatim; long titles clamp without uneven cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/work?page=3");
  const cards = page.locator("[data-video-grid] [data-work-card]");
  const n = await cards.count();
  expect(n).toBeGreaterThan(3);
  for (let i = 0; i < n; i++) {
    const id = await cards.nth(i).getAttribute("data-work-card");
    const db = vids.find((v) => v.youtube_id === id)!;
    const title = cards.nth(i).locator("[data-card-title]");
    await expect(title).toHaveAttribute("title", db.title);
    expect(await title.locator("bdi").textContent()).toBe(db.title);
  }
  // Rows of 3: every card in a row has the same height, and its footer starts at the same y.
  const boxes = await cards.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      const f = e.querySelector("[data-card-footer]")!.getBoundingClientRect();
      const t = e.querySelector("[data-card-title]") as HTMLElement;
      return { top: Math.round(r.top), h: Math.round(r.height), footer: Math.round(f.top), lines: Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)) };
    }),
  );
  const rows = new Map<number, typeof boxes>();
  for (const b of boxes) rows.set(b.top, [...(rows.get(b.top) ?? []), b]);
  for (const row of rows.values()) {
    expect(new Set(row.map((b) => b.h)).size, JSON.stringify(row)).toBe(1);
    expect(new Set(row.map((b) => b.footer)).size, JSON.stringify(row)).toBe(1);
  }
  expect(Math.max(...boxes.map((b) => b.lines))).toBeLessThanOrEqual(3);
  test.info().annotations.push({ type: "card-geometry", description: JSON.stringify(boxes) });
});

test("dialog: plays in-page, shows title + category links + video page link", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL + "/work");
  const card = page.locator("[data-video-grid]:visible [data-youtube-card]").first();
  const id = (await card.getAttribute("data-youtube-card"))!;
  const db = vids.find((v) => v.youtube_id === id)!;
  await card.click();
  const dialog = page.locator("[data-youtube-dialog]");
  await expect(dialog.locator("h2")).toHaveText(db.title);
  await expect(dialog.locator("[data-dialog-details]")).toHaveAttribute("href", `/work/v/${id}`);
  const catIds = links.filter((l) => l.video_id === db.id).map((l) => cats.find((c) => c.id === l.category_id)!.slug);
  for (const s of catIds) await expect(dialog.locator(`[data-dialog-category='${s}']`)).toHaveAttribute("href", `/work?cat=${s}`);

  const frame = page.frameLocator("[data-youtube-dialog] iframe");
  const video = frame.locator("video");
  await video.waitFor({ state: "attached", timeout: 30_000 });
  let state = { t: 0, paused: true };
  for (let i = 0; i < 20; i++) {
    state = await video.evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, paused: v.paused }));
    if (state.t > 0.5 && !state.paused) break;
    if (i === 4) await frame.locator(".ytp-large-play-button, .ytp-play-button").first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  test.info().annotations.push({ type: "playback", description: JSON.stringify(state) });
  expect(state.paused).toBe(false);
  expect(state.t).toBeGreaterThan(0.5);
  await page.screenshot({ path: path.join(SHOTS, "work-dialog-1440.png") });
  await page.keyboard.press("Escape");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(card).toBeFocused();

  await card.click();
  await dialog.locator("[data-dialog-details]").click();
  await expect(page).toHaveURL(new RegExp(`/work/v/${id}$`));
  await expect(page.locator("h1[data-video-title]")).toHaveText(db.title);
  await ctx.close();
});

test("video page: h1, categories, in-page player on click, fallback link, related, WhatsApp text; 404s", async ({ page, request }) => {
  const withCat = vids.find((v) => !v.is_promo && links.some((l) => l.video_id === v.id && l.is_primary))!;
  await page.goto(`/work/v/${withCat.youtube_id}`);
  await expect(page.locator("h1")).toHaveText(withCat.title);
  await expect(page.locator("[data-youtube-fallback]")).toHaveAttribute("href", `https://www.youtube.com/watch?v=${withCat.youtube_id}`);
  expect(await page.locator("iframe").count()).toBe(0);
  const primary = cats.find((c) => c.id === links.find((l) => l.video_id === withCat.id && l.is_primary)!.category_id)!;
  await expect(page.locator(`main [data-category-chip='${primary.slug}']`).first()).toHaveAttribute("href", `/work?cat=${primary.slug}`);

  const related = await page.locator("[data-related] [data-youtube-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-youtube-card")));
  const expectedPool = new Set(videosIn(primary.slug).filter((v) => !v.is_promo && v.id !== withCat.id).map((v) => v.youtube_id));
  expect(related.length).toBe(Math.min(3, expectedPool.size));
  for (const r of related) expect(expectedPool.has(r!)).toBe(true);
  expect(related).not.toContain(withCat.youtube_id);

  const wa = await page.locator("main a[data-whatsapp-cta]").getAttribute("href");
  expect(decodeURIComponent(new URL(wa!).searchParams.get("text")!)).toContain(`«${withCat.title}»`);

  await page.locator("[data-inline-player] button").click();
  await expect(page.locator("[data-inline-player] iframe")).toHaveAttribute("src", new RegExp(`youtube-nocookie\\.com/embed/${withCat.youtube_id}\\?`));
  await axe(page);

  expect((await request.get("/work/v/AAAAAAAAAAA")).status()).toBe(404);
  expect((await request.get("/work/v/not-an-id")).status()).toBe(404);
  expect((await request.get(`/work/v/${withCat.youtube_id}`)).status()).toBe(200);
});

test("home: ≤6 works, no promo, no duplicates, one per category first; chips link to filtered /work", async ({ page }) => {
  await page.goto("/");
  const section = page.locator("#work-title").locator("xpath=ancestor::section");
  const ids = await section.locator("[data-youtube-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-youtube-card")));
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBeLessThanOrEqual(6);
  expect(new Set(ids).size).toBe(ids.length);
  const promo = vids.find((v) => v.is_promo);
  if (promo) expect(ids).not.toContain(promo.youtube_id);
  const primaries = new Set(
    ids.map((id) => {
      const v = vids.find((x) => x.youtube_id === id)!;
      return links.find((l) => l.video_id === v.id && l.is_primary)?.category_id;
    }),
  );
  const catsWithPrimary = new Set(links.filter((l) => l.is_primary && vids.some((v) => v.id === l.video_id && !v.is_promo)).map((l) => l.category_id));
  expect(primaries.size).toBe(Math.min(6, catsWithPrimary.size));

  const chip = section.locator("[data-category-chip]").first();
  const slug = await chip.getAttribute("data-category-chip");
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/work\\?cat=${slug}$`));
  await expect(page.locator(`[data-cat-chip='${slug}']:visible`)).toHaveAttribute("aria-current", "page");
});

test("axe: /work (videos + filtered) has no serious/critical issues", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(process.env.BASE_URL + "/work");
  await axe(page);
  await page.goto(process.env.BASE_URL + `/work?cat=${nonEmptyCats()[0].slug}`);
  await axe(page);
  await ctx.close();
});

test("screenshots: videos tab, filtered category, video page (desktop + mobile)", async ({ browser }) => {
  const target = nonEmptyCats()[0].slug;
  const v = vids.find((x) => !x.is_promo)!;
  for (const [w, h, tag] of [
    [1440, 1000, "1440"],
    [390, 844, "390"],
  ] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const [url, name] of [
      ["/work", "work-videos"],
      [`/work?cat=${target}`, "work-filtered"],
      [`/work/v/${v.youtube_id}`, "video-page"],
    ]) {
      await page.goto(process.env.BASE_URL + url, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${url} @${w}`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${tag}.png`), fullPage: true });
    }
    await ctx.close();
  }
});
