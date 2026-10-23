import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BASE, db, uiLogin } from "./qa-helpers";

/**
 * Visual pass of the UI audit follow-up at 320 / 390 / 768 / 1024 / 1440 / 1920 — OPT-IN, LOCAL ONLY:
 *   VISUAL=1 BASE_URL=http://localhost:3700 npx playwright test ui-audit-visual --project=chromium
 * Real browser screenshots (docs/screenshots/ui-audit/visual/<width>/) plus checks that an overflow test alone misses:
 * clipped text inside buttons/links/cards, the visible focus ring, reduced motion, «DJ وتنسيق الصوت» reading RTL,
 * long Arabic/English titles, the viewer's loading/error states and the admin photo screen. Temporary rows are removed.
 */
test.skip(!process.env.VISUAL, "opt-in: VISUAL=1");
test.describe.configure({ mode: "serial" });
test.setTimeout(10 * 60_000);

const OUT = path.resolve(__dirname, "../../../docs/screenshots/ui-audit/visual");
const WIDTHS = [320, 390, 768, 1024, 1440, 1920];
const STAMP = Date.now().toString(36);
const LONG_TITLE = "حفل زفاف العريس عبد الرحمن محمد عبد الكريم الأحمد — Mithloun Grand Hall Wedding 2026 — تصوير كامل للسهرة والزفة";
const ALBUM = { id: randomUUID(), slug: `qa-visual-${STAMP}`, title: LONG_TITLE };
const PHOTOS = [0, 1, 2].map(() => randomUUID());
const OFFER = { id: randomUUID(), slug: `qa-visual-offer-${STAMP}` };
const uploaded: string[] = [];

async function jpeg(i: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="${["#3a2f1e", "#1f2a33", "#2f1f2a"][i]}"/><circle cx="600" cy="400" r="200" fill="#c9a24a"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await db.from("photo_albums").insert({ id: ALBUM.id, slug: ALBUM.slug, title: ALBUM.title, description: "وصف طويل للألبوم يتضمن English words وأرقام 2026 ورابط https://example.com/very/long/path/that-should-wrap-properly-on-small-screens", is_published: true, sort_order: 0 });
  for (const [i, id] of PHOTOS.entries()) {
    const base = `albums/${ALBUM.id}/${id}`;
    const img = await jpeg(i);
    for (const v of ["original", "display", "thumb"]) {
      await db.storage.from("album-media").upload(`${base}/${v}.jpg`, img, { contentType: "image/jpeg", upsert: true });
      uploaded.push(`${base}/${v}.jpg`);
    }
    await db.from("album_photos").insert({ id, album_id: ALBUM.id, storage_path_original: `${base}/original.jpg`, variants: { thumb: `${base}/thumb.jpg`, display: `${base}/display.jpg` }, width: 1200, height: 800, mime: "image/jpeg", sort_order: (i + 1) * 10, is_published: true, upload_status: "ready", alt_text: i === 0 ? "Bride & groom — العروسان في القاعة" : null });
  }
  await db.from("photo_albums").update({ cover_photo_id: PHOTOS[0] }).eq("id", ALBUM.id);
  await db.from("offers").insert({ id: OFFER.id, slug: OFFER.slug, title: `${LONG_TITLE} — عرض`, description: "1. تصوير سهرة العريس\n- كاميرا صور لتوثيق النقوط.\n- DJ وتنسيق الصوت\n2. Drone aerial shots للقاعة\n3. ألبوم مطبوع 30×40\n4. فلاشة\n5. برومو", status: "published", show_price: false });
});
test.afterAll(async () => {
  await db.from("photo_albums").update({ cover_photo_id: null }).eq("id", ALBUM.id);
  await db.from("album_photos").delete().eq("album_id", ALBUM.id);
  await db.from("photo_albums").delete().eq("id", ALBUM.id);
  if (uploaded.length) await db.storage.from("album-media").remove(uploaded);
  await db.from("offers").delete().eq("id", OFFER.id);
});

/** Elements whose own text is clipped (wider than their box) — buttons, links, badges, card titles. Line clamps
 *  (intentional, -webkit-line-clamp) are excluded. */
async function clipped(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a, [data-offer-card] *, [data-album-card] *, label, h1, h2, h3"))) {
      if (!el.checkVisibility() || !el.textContent?.trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.webkitLineClamp && cs.webkitLineClamp !== "none") continue;
      if (cs.textOverflow === "ellipsis") continue;
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue; // visually-hidden (sr-only) until focused, e.g. «تخطَّ إلى المحتوى»
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== "visible") out.push(`${el.tagName.toLowerCase()} «${el.textContent.trim().slice(0, 40)}» ${el.scrollWidth}>${el.clientWidth}`);
    }
    return out;
  });
}
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function gotoFresh(page: Page, url: string, ready: string) {
  await expect(async () => {
    await page.goto(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`);
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });
}

test("public pages at six widths: screenshots, no clipping, no horizontal scroll, RTL mixed text", async ({ browser }) => {
  const report: Record<string, unknown>[] = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "ar", reducedMotion: "reduce" });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("sultan-intro-seen", "1");
        sessionStorage.setItem("sultan-intro-seen", "1");
      } catch {}
    });
    const page = await ctx.newPage();
    const dir = path.join(OUT, String(w));
    fs.mkdirSync(dir, { recursive: true });
    const pages: [string, string, string][] = [
      ["home", "/", "main"],
      ["offers", "/offers", `[data-offer-card='${OFFER.slug}']`],
      ["offer-detail", `/offers/${OFFER.slug}`, "[data-offer-description]"],
      ["work-photos", "/work?tab=photos", `[data-album-card='${ALBUM.slug}']`],
      ["album", `/work/albums/${ALBUM.slug}`, `[data-album-photo='${PHOTOS[0]}']`],
      ["services", "/services", "main"],
      ["privacy", "/privacy", "main"],
      ["contact", "/contact", "main"],
    ];
    for (const [name, url, ready] of pages) {
      await gotoFresh(page, url, ready);
      await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: w <= 768 });
      const c = await clipped(page);
      report.push({ w, page: name, overflowX: await overflowX(page), clipped: c });
      expect(await overflowX(page), `${name} @${w}`).toBeLessThanOrEqual(0);
      expect(c, `${name} @${w} clipped`).toEqual([]);
    }
    // «DJ وتنسيق الصوت» inside the offer list reads right-to-left: the Arabic words sit LEFT of «DJ» on screen
    await page.goto(`${BASE}/offers/${OFFER.slug}`);
    const li = page.locator("[data-offer-description] li", { hasText: "DJ وتنسيق الصوت" }).first();
    const pos = await li.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) if (node.textContent?.includes("DJ")) break;
      if (!node?.textContent) return null;
      const box = (word: string) => {
        const i = node!.textContent!.indexOf(word);
        const r = document.createRange();
        r.setStart(node!, i);
        r.setEnd(node!, i + word.length);
        return r.getBoundingClientRect();
      };
      return { dj: box("DJ").left, arabic: box("وتنسيق").left, dir: getComputedStyle(el).direction };
    });
    expect(pos?.dir).toBe("rtl");
    expect(pos!.dj, "«DJ» starts the RTL line (right of «وتنسيق»)").toBeGreaterThan(pos!.arabic);
    // keyboard: the first Tab stop shows a visible focus indicator
    await page.keyboard.press("Tab");
    const focusVisible = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return false;
      const cs = getComputedStyle(el);
      return cs.outlineStyle !== "none" || cs.boxShadow !== "none" || cs.textDecorationLine !== "none";
    });
    expect(focusVisible, `focus ring @${w}`).toBe(true);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
});

test("viewer states at 390 and 1440: loading, error with retry (screenshots), reduced motion stops the spinner", async ({ browser }) => {
  for (const w of [390, 1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    let fail = true;
    await page.route("**/p/*/display*", async (route) => {
      if (route.request().url().includes(PHOTOS[1]) && fail) return route.fulfill({ status: 500, body: "x" });
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await gotoFresh(page, `/work/albums/${ALBUM.slug}`, `[data-album-photo='${PHOTOS[0]}']`);
    await page.locator(`[data-album-photo='${PHOTOS[0]}']`).click();
    const lb = page.getByTestId("lightbox");
    await expect(lb.locator("[data-lightbox-loading]")).toBeVisible();
    expect(await lb.locator("[data-lightbox-loading] .animate-spin").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await page.screenshot({ path: path.join(OUT, String(w), "viewer-loading.png") });
    await page.keyboard.press("ArrowLeft");
    await expect(lb.locator("[data-lightbox-error]")).toBeVisible();
    await page.screenshot({ path: path.join(OUT, String(w), "viewer-error.png") });
    fail = false;
    await lb.locator("[data-lightbox-retry]").click();
    await expect(lb.locator(`[data-lightbox-image='${PHOTOS[1]}']`)).toHaveCSS("opacity", "1", { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(lb).toHaveCount(0);
    await ctx.close();
  }
});

test("admin album photos at six widths: both views, long names, 44px targets, no clipping", async ({ browser }) => {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    await uiLogin(page, "owner", `/admin/albums/${ALBUM.id}`);
    await page.goto(`${BASE}/admin/albums/${ALBUM.id}`);
    await expect(page.getByTestId("album-photos")).toBeVisible();
    const dir = path.join(OUT, String(w));
    await page.screenshot({ path: path.join(dir, "admin-photos-details.png"), fullPage: true });
    expect(await overflowX(page), `admin details @${w}`).toBeLessThanOrEqual(0);
    // touch targets inside the photo list are at least 44px tall
    const small = await page.locator("[data-testid=album-photos] button, [data-testid=album-photos] input").evaluateAll((els) =>
      els.filter((e) => (e as HTMLElement).checkVisibility() && e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent || (e as HTMLInputElement).name || e.tagName).trim().slice(0, 30)),
    );
    expect(small, `small targets @${w}`).toEqual([]);
    await page.getByTestId("photo-view-order").click();
    await expect(page.getByTestId("photo-reorder")).toBeVisible();
    await page.screenshot({ path: path.join(dir, "admin-photos-order.png"), fullPage: true });
    expect(await overflowX(page), `admin order @${w}`).toBeLessThanOrEqual(0);
    const smallMove = await page.locator("[data-testid=photo-reorder] [data-move]").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5).length);
    expect(smallMove, `reorder buttons @${w}`).toBe(0);
    await ctx.close();
  }
});
