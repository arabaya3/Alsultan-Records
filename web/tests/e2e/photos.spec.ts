import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { db, revalidatePublic } from "./qa-helpers";

/**
 * Photos tab, album page, lightbox and the gated /p route. LOCAL STACK ONLY.
 * Setup creates a temporary published album (3 generated images + thumb/display variants uploaded to the
 * private `album-media` bucket with the secret key) and removes it afterwards; the admin UI is not used.
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/photos.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

const SHOTS = path.resolve(__dirname, "../../../docs/screenshots/gallery");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const ALBUM = { id: randomUUID(), slug: `qa-album-${Date.now().toString(36)}`, title: "ألبوم اختبار — عرس تجريبي في ميثلون 2026" };
const SIZES = [
  [1600, 1067],
  [1067, 1600],
  [1600, 900],
] as const;
const PHOTOS = SIZES.map(([w, h], i) => ({ id: randomUUID(), w, h, alt: `صورة اختبار رقم ${i + 1}` }));
const SOURCE = { label: "صفحة الاستوديو على فيسبوك", url: "https://www.facebook.com/example" };
const uploaded: string[] = [];

async function image(w: number, h: number, i: number, label: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${["#3a2f1e", "#1f2a33", "#2f1f2a"][i]}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#c9a24a"/><text x="50%" y="90%" font-size="${Math.round(h / 14)}" fill="#fff" text-anchor="middle" font-family="sans-serif">${label} ${i + 1}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

async function put(p: string, body: Buffer) {
  const { error } = await db.storage.from("album-media").upload(p, body, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload ${p}: ${error.message}`);
  uploaded.push(p);
}

async function cleanup() {
  await db.from("photo_albums").update({ cover_photo_id: null }).eq("id", ALBUM.id);
  await db.from("album_photos").delete().eq("album_id", ALBUM.id);
  await db.from("photo_albums").delete().eq("id", ALBUM.id);
  if (uploaded.length) await db.storage.from("album-media").remove(uploaded);
}

const otherAlbumsPublished = async () => (await db.from("photo_albums").select("id").eq("is_published", true)).data?.length ?? 0;

test("empty state is honest when no album is published", async ({ page }) => {
  test.skip((await otherAlbumsPublished()) > 0, "published albums already exist in this stack");
  await page.goto("/work?tab=photos");
  await expect(page.locator("[data-work-tab='photos']")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("لا توجد ألبومات منشورة بعد")).toBeVisible();
});

test.describe("with a temporary published album", () => {
  test.beforeAll(async () => {
    await cleanup();
    const { error: ae } = await db.from("photo_albums").insert({
      id: ALBUM.id,
      slug: ALBUM.slug,
      title: ALBUM.title,
      description: "ألبوم مؤقت ينشئه الاختبار ويحذفه.\nسطر ثانٍ للوصف.",
      event_date: "2026-08-14",
      source_label: SOURCE.label,
      source_url: SOURCE.url,
      sort_order: 1,
      is_published: true,
    });
    if (ae) throw new Error(ae.message);
    for (const [i, p] of PHOTOS.entries()) {
      const base = `albums/${ALBUM.id}/${p.id}`;
      const full = await image(p.w, p.h, i, "original");
      await put(`${base}/original.jpg`, full);
      await put(`${base}/display.jpg`, await sharp(full).resize({ width: 1200, height: 1200, fit: "inside" }).jpeg().toBuffer());
      await put(`${base}/thumb.jpg`, await sharp(full).resize({ width: 480, height: 480, fit: "inside" }).jpeg().toBuffer());
      const { error } = await db.from("album_photos").insert({
        id: p.id,
        album_id: ALBUM.id,
        storage_path_original: `${base}/original.jpg`,
        variants: { thumb: `${base}/thumb.jpg`, display: `${base}/display.jpg` },
        width: p.w,
        height: p.h,
        mime: "image/jpeg",
        alt_text: p.alt,
        sort_order: i + 1,
        is_published: true,
        upload_status: "ready",
      });
      if (error) throw new Error(error.message);
    }
    await db.from("photo_albums").update({ cover_photo_id: PHOTOS[1].id }).eq("id", ALBUM.id);
  });
  test.afterAll(cleanup);

  // Public pages are cached ("use cache", minutes). A fresh server or the tag TTL makes the album visible;
  // wait for it rather than assuming instant invalidation.
  async function gotoAlbumList(page: Page) {
    await expect(async () => {
      await page.goto(`/work?tab=photos&r=${Date.now()}`);
      await expect(page.locator(`[data-album-card='${ALBUM.slug}']`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000 });
  }

  test("photos tab: album card with whole cover (display variant, contain, 2:3), date, count; tab state in URL", async ({ page }) => {
    await gotoAlbumList(page);
    await expect(page.locator("[data-work-tab='photos']")).toHaveAttribute("aria-current", "page");
    const card = page.locator(`[data-album-card='${ALBUM.slug}']`);
    await expect(card).toContainText(ALBUM.title);
    await expect(card).toContainText("٣ صور");
    await expect(card.locator("img")).toHaveAttribute("src", `/p/${PHOTOS[1].id}/display`);
    await expect(card.locator("img")).toHaveCSS("object-fit", "contain");
    await expect.poll(() => card.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await page.locator("[data-work-tab='videos']").click();
    await expect(page).toHaveURL(/\/work$/);
    await page.goBack();
    await expect(page).toHaveURL(/tab=photos/);
  });

  test("/p route: thumb + display served privately; original, bad ids and unpublished → 404 no-store", async ({ request }) => {
    const ok = await request.get(`/p/${PHOTOS[0].id}/thumb`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("image/jpeg");
    expect(ok.headers()["cache-control"]).toBe("private, max-age=300");
    expect(ok.headers()["cdn-cache-control"]).toBe("no-store");
    const meta = await sharp(await ok.body()).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(480);
    const disp = await request.get(`/p/${PHOTOS[0].id}/display`);
    expect(disp.status()).toBe(200);
    expect(Math.max((await sharp(await disp.body()).metadata()).width!)).toBeLessThanOrEqual(1200);
    for (const u of [`/p/${PHOTOS[0].id}/original`, `/p/${randomUUID()}/thumb`, "/p/not-a-uuid/thumb", `/p/${PHOTOS[0].id}/..%2Foriginal`]) {
      const r = await request.get(u);
      expect(r.status(), u).toBe(404);
      expect(r.headers()["cache-control"], u).toBe("no-store");
    }
    await db.from("album_photos").update({ is_published: false }).eq("id", PHOTOS[2].id);
    const hidden = await request.get(`/p/${PHOTOS[2].id}/thumb`);
    expect(hidden.status()).toBe(404);
    await db.from("album_photos").update({ is_published: true }).eq("id", PHOTOS[2].id);
    expect((await request.get(`/p/${PHOTOS[2].id}/thumb`)).status()).toBe(200);
  });

  test("album page: reserved ratios, lazy thumbs, source credit; lightbox keyboard (RTL), swipe, Esc, focus return", async ({ page }) => {
    await expect(async () => {
      const r = await page.goto(`/work/albums/${ALBUM.slug}?r=${Date.now()}`);
      expect(r?.status()).toBe(200);
    }).toPass({ timeout: 90_000 });
    await expect(page.locator("h1")).toContainText(ALBUM.title);
    await expect(page.locator("[data-album-source] a")).toHaveAttribute("href", SOURCE.url);
    const tiles = page.locator("[data-album-photo]");
    await expect(tiles).toHaveCount(3);
    for (const [i, p] of PHOTOS.entries()) {
      const box = (await tiles.nth(i).boundingBox())!;
      expect(Math.abs(box.width / box.height - p.w / p.h)).toBeLessThan(0.02);
      await expect(tiles.nth(i).locator("img")).toHaveAttribute("src", `/p/${p.id}/thumb`);
    }

    await tiles.nth(0).click();
    const lb = page.getByTestId("lightbox");
    await expect(lb).toBeVisible();
    await expect(lb).toContainText("1 من 3");
    await expect(lb.locator("img")).toHaveAttribute("src", `/p/${PHOTOS[0].id}/display`);
    await expect(lb.locator("img")).toHaveAttribute("alt", PHOTOS[0].alt);
    await expect(lb.locator("[data-lightbox-credit] a")).toHaveAttribute("href", SOURCE.url);
    await expect(lb.locator("[data-lightbox-alt]")).toHaveText(PHOTOS[0].alt);
    await expect(lb.getByRole("button", { name: "إغلاق" })).toBeFocused();

    await page.keyboard.press("ArrowLeft"); // RTL: ← = next
    await expect(lb).toContainText("2 من 3");
    await page.keyboard.press("ArrowLeft");
    await expect(lb).toContainText("3 من 3");
    await page.keyboard.press("ArrowRight"); // previous
    await expect(lb).toContainText("2 من 3");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-testid='lightbox']")))).toBe(true);
    }
    await page.screenshot({ path: path.join(SHOTS, "album-lightbox-1440.png") });

    // Swipe (RTL: swipe right = next).
    await lb.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 200, clientY: 400 }], changedTouches: [{ identifier: 1, clientX: 200, clientY: 400 }] });
    await lb.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 420, clientY: 410 }] });
    await expect(lb).toContainText("3 من 3");
    await lb.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 420, clientY: 400 }], changedTouches: [{ identifier: 1, clientX: 420, clientY: 400 }] });
    await lb.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 150, clientY: 400 }] });
    await expect(lb).toContainText("2 من 3");

    await page.keyboard.press("Escape");
    await expect(lb).toHaveCount(0);
    await expect(tiles.nth(0)).toBeFocused();
  });

  test("error states: a failing photo shows an inline error, not a broken image", async ({ page }) => {
    await page.route(`**/p/${PHOTOS[1].id}/**`, (r) => r.fulfill({ status: 404, headers: { "cache-control": "no-store" }, body: "Not found" }));
    await page.goto(`/work/albums/${ALBUM.slug}`);
    await expect(page.locator(`[data-album-photo='${PHOTOS[1].id}'] [data-photo-error]`)).toBeVisible();
    await expect(page.locator(`[data-album-photo='${PHOTOS[0].id}'] img`)).toBeVisible();
    await page.locator(`[data-album-photo='${PHOTOS[1].id}']`).click();
    await expect(page.locator("[data-lightbox-error]")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("unknown / unpublished album → 404", async ({ request }) => {
    expect((await request.get("/work/albums/no-such-album-xyz")).status()).toBe(404);
    expect((await request.get("/work/albums/BAD_slug")).status()).toBe(404);
  });

  test("axe + screenshots: photos tab and album page (desktop + mobile), mobile lightbox", async ({ browser }) => {
    for (const [w, h, tag] of [
      [1440, 1000, "1440"],
      [390, 844, "390"],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", hasTouch: w < 500 });
      const page = await ctx.newPage();
      for (const [url, name] of [
        ["/work?tab=photos", "work-photos"],
        [`/work/albums/${ALBUM.slug}`, "album"],
      ]) {
        await page.goto(process.env.BASE_URL + url, { waitUntil: "networkidle" });
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad.map((v) => v.id), `${url} @${w}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await page.screenshot({ path: path.join(SHOTS, `${name}-${tag}.png`), fullPage: true });
      }
      if (w < 500) {
        await page.locator("[data-album-photo]").first().click();
        await expect(page.getByTestId("lightbox").locator("img")).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, "album-lightbox-390.png") });
      }
      await ctx.close();
    }
  });
});

// this suite seeds/removes albums directly in the DB: expire the public album cache through the app afterwards, so
// no later page shows an album that no longer exists (what the admin actions do with updateTag)
test.beforeAll(() => revalidatePublic(["photo-albums"]));
test.afterAll(() => revalidatePublic(["photo-albums"]));
