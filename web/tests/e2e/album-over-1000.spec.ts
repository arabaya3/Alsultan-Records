import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { BASE, db, newLoggedIn, skipSiteIntro } from "./qa-helpers";

/** Albums past Supabase's 1000-row page: the public count, the album page and the admin editor see every photo. Synthetic rows only. */
test.describe.configure({ mode: "serial" });
test.setTimeout(4 * 60_000);

const N = 1100;
const album = randomUUID();
const slug = `e2e-over-1000-${Date.now().toString(36)}`;

test.beforeAll(async () => {
  await db.from("photo_albums").insert({ id: album, slug, title: "اختبار ألبوم كبير", is_published: false });
  const rows = Array.from({ length: N }, (_, i) => {
    const id = randomUUID();
    const base = `albums/${album}/${id}`;
    return { id, album_id: album, storage_path_original: `${base}/original.jpg`, mime: "image/jpeg", bytes: 10, upload_status: "ready", is_published: true, sort_order: (i + 1) * 10, variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` } };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("album_photos").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  const { error } = await db.from("photo_albums").update({ is_published: true }).eq("id", album);
  if (error) throw new Error(error.message);
});
test.afterAll(async () => {
  await db.from("album_photos").delete().eq("album_id", album);
  await db.from("photo_albums").delete().eq("id", album);
});

test("public: the album card counts every photo and the album page lists every photo", async ({ page }) => {
  await skipSiteIntro(page);
  await expect
    .poll(async () => {
      await page.goto(`${BASE}/work?tab=photos`);
      return page.locator(`a[data-album-card][href*="${slug}"]`).count();
    }, { timeout: 90_000 })
    .toBeGreaterThan(0);
  await expect(page.locator(`a[data-album-card][href*="${slug}"]`).first()).toContainText(`${N.toLocaleString("ar-PS", { useGrouping: false })} صورة`);
  await page.goto(`${BASE}/work/albums/${slug}`);
  const html = await page.content();
  expect(new Set(html.match(/\/p\/[0-9a-f-]{36}\/thumb/g) ?? []).size).toBe(N);
});

test("admin: the album editor shows every photo", async ({ browser }) => {
  const admin = await newLoggedIn(browser, "owner", `/admin/albums/${album}`);
  await expect(admin.locator("body")).toContainText(new RegExp(`${N.toLocaleString("ar-PS", { useGrouping: false })}|${N.toLocaleString("ar-PS")}|${N}`), { timeout: 60_000 });
  await admin.context().close();
});
