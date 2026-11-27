import { expect, test, type Page } from "@playwright/test";
import { BASE, db, overflowPx, refreshAlbumsCache, skipSiteIntro } from "./qa-helpers";

/**
 * Home hero slideshow (published albums, newest first) and the shortened hero. LOCAL STACK ONLY (writes photo flags with
 * the secret key, restores them). Relies on the seeded published albums.
 *   BASE_URL=http://localhost:4100 npx playwright test home-hero-slideshow --project=chromium
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

type Album = { slug: string; title: string };
const api = async <T,>(q = "") => (await (await fetch(`${BASE}/api/hero-slides${q}`)).json()) as T;
const sharp = (p: Page) => p.locator("[data-home-hero-photo] img[data-hero-photo=sharp]");
const onLayer = (p: Page) => p.locator("[data-home-hero-photo] .hero-slide[data-on='1'] img").last();

test("HS1: the album list is the published albums with photos, newest published first; an unknown album has no photos", async () => {
  const { albums } = await api<{ albums: Album[] }>();
  expect(albums.length).toBeGreaterThan(0);
  const rows = (await db.from("photo_albums").select("slug, listed_at, is_published, deleted_at").in("slug", albums.map((a) => a.slug))).data ?? [];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  for (const a of albums) {
    expect(bySlug.get(a.slug)?.is_published, a.slug).toBe(true);
    expect(bySlug.get(a.slug)?.deleted_at, a.slug).toBeNull();
  }
  const listed = albums.map((a) => bySlug.get(a.slug)!.listed_at as string);
  expect([...listed].sort().reverse()).toEqual(listed);
  expect((await api<{ ids: string[] }>("?album=no-such-album-xyz")).ids).toEqual([]);
  expect((await fetch(`${BASE}/api/hero-slides?album=${encodeURIComponent("../x")}`)).status).toBe(400);
});

test("HS2: an album's photos come in album order; a hidden photo leaves the list (and the slideshow) after the album is saved", async ({ browser }) => {
  const { albums } = await api<{ albums: Album[] }>();
  const album = (await db.from("photo_albums").select("id").eq("slug", albums[0].slug).single()).data!;
  const { ids } = await api<{ ids: string[] }>(`?album=${albums[0].slug}`);
  expect(ids.length).toBeGreaterThan(0);
  const hide = ids[0];
  try {
    expect((await db.from("album_photos").update({ is_published: false }).eq("id", hide)).error).toBeNull();
    await refreshAlbumsCache(browser, album.id);
    await expect.poll(async () => (await api<{ ids: string[] }>(`?album=${albums[0].slug}`)).ids.includes(hide), { timeout: 30_000 }).toBe(false);
    // The image route refuses it too, so a slideshow holding an old list skips it (onerror → next photo).
    expect((await fetch(`${BASE}/p/${hide}/display`)).status).toBe(404);
  } finally {
    await db.from("album_photos").update({ is_published: true }).eq("id", hide);
    await refreshAlbumsCache(browser, album.id);
  }
});

test("HS3: the hero opens on the saved photo, then moves on to the newest album from its first photo; no album label on the photo", async ({ page }) => {
  await skipSiteIntro(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const { albums } = await api<{ albums: Album[] }>();
  const { ids } = await api<{ ids: string[] }>(`?album=${albums[0].slug}`);
  await page.goto(`${BASE}/`);
  await expect(sharp(page)).toBeVisible();
  const opening = await sharp(page).getAttribute("src");
  const expected = ids.find((id) => `/p/${id}/display` !== opening)!;
  await expect.poll(async () => onLayer(page).getAttribute("src"), { timeout: 15_000 }).toBe(`/p/${expected}/display`);
  await expect(page.locator("[data-home-hero-photo] a")).toHaveCount(0); // owner request: no album name on the photo
  // The hero keeps its size while photos change.
  const h1 = (await page.locator("[data-home-hero]").boundingBox())!.height;
  await page.waitForTimeout(1500);
  expect((await page.locator("[data-home-hero]").boundingBox())!.height).toBe(h1);
});

test("HS4: reduced motion: the photo never changes on its own", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`);
  await expect(sharp(page)).toBeVisible();
  await page.waitForTimeout(9_000);
  await expect(page.locator("[data-home-hero-photo] .hero-slide")).toHaveCount(1);
  await ctx.close();
});

test("HS5: shortened hero: 430–460 px on a 1440 desktop; at 390 nothing is cut and nothing scrolls sideways", async ({ page }) => {
  await skipSiteIntro(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`);
  const h = (await page.locator("[data-home-hero]").boundingBox())!.height;
  expect(h).toBeGreaterThanOrEqual(430);
  expect(h).toBeLessThanOrEqual(460);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`);
  expect(await overflowPx(page)).toBe(0);
  const hero = (await page.locator("[data-home-hero]").boundingBox())!;
  for (const sel of ["#hero-title", "[data-home-hero] [data-whatsapp-cta], [data-home-hero] a[href='/contact']"]) {
    const b = (await page.locator(sel).first().boundingBox())!;
    expect(b.y + b.height, sel).toBeLessThanOrEqual(hero.y + hero.height);
  }
});
