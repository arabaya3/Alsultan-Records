import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, revalidatePublic } from "./qa-helpers";

/**
 * ST13 — the album wall stays balanced for any group size (1–5 prints). LOCAL STACK ONLY.
 * Uses temporary categories on the local albums (category_id only), restored afterwards.
 *   BASE_URL=http://localhost:3700 npx playwright test studio-wall-groups --project=chromium
 */
test.describe.configure({ mode: "serial" });
const GPU = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
test.use({ launchOptions: async ({ browserName }, provide) => provide(browserName === "chromium" ? { args: GPU } : {}), viewport: { width: 1440, height: 900 } });

const STAMP = Date.now().toString(36);
const CATS = [1, 2, 3, 4, 5].map((n) => ({ id: randomUUID(), slug: `qa-wall-${n}-${STAMP}`, n }));
let original: { id: string; category_id: string | null }[] = [];

test.beforeAll(async () => {
  const { data } = await db.from("photo_albums").select("id, category_id").eq("is_published", true).order("sort_order");
  original = data ?? [];
  test.skip(original.length < 5, "needs at least 5 published local albums");
  for (const [i, c] of CATS.entries()) {
    const { error } = await db.from("album_categories").insert({ id: c.id, slug: c.slug, title: `اختبار ${c.n}`, sort_order: 900 + i, is_published: true });
    if (error) throw new Error(error.message);
  }
});
test.afterAll(async () => {
  for (const a of original) await db.from("photo_albums").update({ category_id: a.category_id }).eq("id", a.id);
  await db.from("album_categories").delete().in("id", CATS.map((c) => c.id));
  await revalidatePublic(["photo-albums", "site-content"]);
});

async function wallRects(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-studio-wall] > li:not([hidden])")].map((li) => {
      const r = li.getBoundingClientRect();
      return { cx: r.left + r.width / 2, w: r.width, projected: li.dataset.projected === "1" };
    }),
  );
}

for (const n of [1, 2, 3, 4, 5]) {
  test(`ST13 a group of ${n} hangs centred on the wall, every print a working link`, async ({ page }) => {
    const cat = CATS[n - 1];
    const ids = original.slice(0, n).map((a) => a.id);
    await db.from("photo_albums").update({ category_id: null }).in("id", original.map((a) => a.id));
    await db.from("photo_albums").update({ category_id: cat.id }).in("id", ids);
    await revalidatePublic(["photo-albums", "site-content"]);
    await page.goto(`/work?tab=photos&cat=${cat.slug}`);
    test.skip((await page.evaluate(() => document.documentElement.dataset.studio)) !== "scene", "needs the GPU scene");
    await expect.poll(async () => (await wallRects(page)).filter((r) => r.projected).length, { timeout: 20_000 }).toBe(n);
    await page.waitForTimeout(900); // let the re-centring settle
    const rects = await wallRects(page);
    const mid = rects.reduce((a, r) => a + r.cx, 0) / rects.length;
    expect(Math.abs(mid - 720), `group centre ${mid.toFixed(0)} vs screen centre 720`).toBeLessThan(1440 * 0.06);
    for (const r of rects) expect(r.w).toBeGreaterThan(120); // prints are a usable size whatever the count
    // keyboard: each print is a focusable link with a name
    const links = page.locator("[data-studio-wall] > li:not([hidden]) a");
    await expect(links).toHaveCount(n);
    for (let i = 0; i < n; i++) await expect(links.nth(i)).toHaveAccessibleName(/.+/);
  });
}
