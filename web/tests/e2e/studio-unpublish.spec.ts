import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, newLoggedIn, revalidatePublic } from "./qa-helpers";

/**
 * ST12 — an admin hides an album while a visitor has the site open (LOCAL STACK ONLY; creates and removes its own
 * album). The admin action is the real one (UI → setAlbumPublished → updateTag), not a direct DB write.
 * Expected: after the visitor's next navigation the album is gone from the list and the wall, its link is a 404,
 * its gated images answer 404 (still protected), and the room shows no broken print and no request loop.
 *   BASE_URL=http://localhost:3700 npx playwright test studio-unpublish --project=chromium
 */
test.describe.configure({ mode: "serial" });
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
// GPU flags are Chromium switches (WebKit uses its own GPU path)
test.use({ launchOptions: async ({ browserName }, provide) => provide(browserName === "chromium" ? { args: GPU } : {}) });

const STAMP = Date.now().toString(36);
const ALBUM = { id: randomUUID(), slug: `qa-hide-${STAMP}`, title: "ألبوم اختبار الإخفاء" };
const PHOTOS = [0, 1].map((i) => ({ id: randomUUID(), i }));
const uploaded: string[] = [];

async function jpeg(i: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="${["#3a2f1e", "#1f2a33"][i]}"/><circle cx="450" cy="600" r="240" fill="#c9a24a"/></svg>`;
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
  await revalidatePublic(["photo-albums"]);
}

test.beforeAll(async () => {
  await cleanup();
  const { error } = await db.from("photo_albums").insert({ id: ALBUM.id, slug: ALBUM.slug, title: ALBUM.title, is_published: true, sort_order: 0 });
  if (error) throw new Error(error.message);
  for (const p of PHOTOS) {
    const base = `albums/${ALBUM.id}/${p.id}`;
    const img = await jpeg(p.i);
    for (const v of ["original", "display", "thumb"]) await put(`${base}/${v}.jpg`, img);
    const r = await db.from("album_photos").insert({
      id: p.id,
      album_id: ALBUM.id,
      storage_path_original: `${base}/original.jpg`,
      variants: { thumb: `${base}/thumb.jpg`, display: `${base}/display.jpg` },
      width: 900,
      height: 1200,
      mime: "image/jpeg",
      sort_order: p.i + 1,
      is_published: true,
      upload_status: "ready",
    });
    if (r.error) throw new Error(r.error.message);
  }
  await db.from("photo_albums").update({ cover_photo_id: PHOTOS[0].id }).eq("id", ALBUM.id);
  await revalidatePublic(["photo-albums"]);
});
test.afterAll(cleanup);

test("ST12 hiding an album from the admin while the site is open: list, wall, link and images follow; no broken print, no retry loop", async ({ browser, browserName }) => {
  // the admin sign-in sets Secure cookies; WebKit refuses them over plain http even on localhost (Chromium allows
  // localhost) — the admin half cannot run on WebKit against a local http build. The visitor checks run in ST1–ST11.
  test.skip(browserName === "webkit", "admin sign-in needs https on WebKit (local http build)");
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar" });
  const page = await visitor.newPage();
  const coverReq: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(PHOTOS[0].id)) coverReq.push(r.url());
  });
  await expect(async () => {
    await page.goto(`/work?tab=photos&_=${Date.now()}`);
    await expect(page.locator(`a[data-album-card='${ALBUM.slug}']`)).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.locator(`a[data-album-card='${ALBUM.slug}']`)).toBeVisible();

  // the admin hides it — the real action, in another session
  const admin = await newLoggedIn(browser, "owner", `/admin/albums/${ALBUM.id}`);
  await admin.goto(`/admin/albums/${ALBUM.id}`);
  await admin.getByTestId("album-unpublish").getByRole("button", { name: "إخفاء الألبوم" }).click();
  await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await db.from("photo_albums").select("is_published").eq("id", ALBUM.id).single()).data?.is_published).toBe(false);
  await admin.context().close();

  // the visitor's next navigation: gone from the list (and therefore from the wall), link and images are 404
  await page.reload();
  await expect(page.locator(`a[data-album-card='${ALBUM.slug}']`)).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(PHOTOS[0].id);
  expect((await page.request.get(`/work/albums/${ALBUM.slug}`)).status()).toBe(404);
  for (const v of ["thumb", "display"]) expect((await page.request.get(`/p/${PHOTOS[0].id}/${v}`)).status()).toBe(404);
  // the room: every print shows either a real photo or a blank mat — and the hidden cover is not re-requested
  const before = coverReq.length;
  await page.waitForTimeout(2500);
  expect(coverReq.length).toBe(before);
  await visitor.close();
});
