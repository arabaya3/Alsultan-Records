import { expect, test, type Browser, type Page } from "@playwright/test";
import { BASE, db, newLoggedIn, skipSiteIntro } from "./qa-helpers";

/**
 * Home hero backdrop: phones load the thumb variant, wider screens the display variant, both through the gated /p route.
 * Isolated stack only. Sets the hero through the database + an admin save (which expires the cache), then restores it.
 */
test.describe.configure({ mode: "serial" });

let photoId = "";
let before: string | null = null;

async function saveHome(browser: Browser) {
  const admin = await newLoggedIn(browser, "owner", "/admin/content/home");
  const form = admin.getByTestId("home-form");
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await admin.close();
}

async function openHome(page: Page) {
  await skipSiteIntro(page);
  const asked: string[] = [];
  // Finished downloads: the browser's speculative request for <img src> is cancelled before any bytes when <source> matches.
  page.on("requestfinished", (r) => {
    if (r.url().includes(`/p/${photoId}/`)) asked.push(r.url().split("/").pop()!);
  });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500); // route prefetches run after load
  return asked;
}
const hero = (page: Page) => page.locator("[data-hero-intro] > picture img");

test.beforeAll(async ({ browser }) => {
  const settings = (await db.from("business_settings").select("hero_cover_photo_id").eq("id", 1).single()).data!;
  before = settings.hero_cover_photo_id;
  // A photo that is nobody's cover: a home album card must not download its display variant for its own reasons.
  const covers = ((await db.from("photo_albums").select("cover_photo_id")).data ?? []).map((a) => a.cover_photo_id);
  const photos = (await db.from("album_photos").select("id").eq("is_published", true).eq("upload_status", "ready").limit(200)).data!;
  photoId = photos.find((p) => !covers.includes(p.id))!.id;
  await db.from("business_settings").update({ hero_cover_photo_id: photoId }).eq("id", 1);
  await saveHome(browser);
});

test.afterAll(async ({ browser }) => {
  await db.from("album_photos").update({ is_published: true }).eq("id", photoId);
  await db.from("business_settings").update({ hero_cover_photo_id: before }).eq("id", 1);
  await saveHome(browser);
});

test.describe("phone", () => {
  // Set when the page is created, as on a real phone: resizing a 1440px page afterwards would fetch both variants.
  test.use({ viewport: { width: 390, height: 844 } });
  test("the /work page still preloads and shows its own hero when opened", async ({ page }) => {
    await skipSiteIntro(page);
    await page.goto(`${BASE}/work`);
    const img = page.locator(`img[src="/p/${photoId}/display"]`).first();
    await expect(img).toHaveAttribute("fetchpriority", "high");
    expect(await img.evaluate((i: HTMLImageElement) => i.decode().then(() => i.naturalWidth))).toBeGreaterThan(0);
  });
  test("390px: only the thumb is downloaded, including after route prefetches, and it is the image shown", async ({ page }) => {
  const asked = await openHome(page);
  await expect.poll(() => hero(page).evaluate((i: HTMLImageElement) => i.currentSrc)).toContain(`/p/${photoId}/thumb`);
  expect(asked).toEqual(["thumb"]);
  expect(await hero(page).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});
});

test("1440px: the hero stays on the display variant, and the thumb is not downloaded for it", async ({ page }) => {
  const asked = await openHome(page);
  await expect.poll(() => hero(page).evaluate((i: HTMLImageElement) => i.currentSrc)).toContain(`/p/${photoId}/display`);
  expect(asked).toContain("display");
  expect(asked).not.toContain("thumb");
  await expect(hero(page)).toHaveClass(/opacity-35/);
  await expect(hero(page)).toHaveClass(/blur-\[2px\]/);
});

test("the thumb is never stored by a CDN, and stops loading when the photo is withdrawn", async ({ page }) => {
  const ok = await page.request.get(`${BASE}/p/${photoId}/thumb`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toContain("private");
  expect(ok.headers()["cache-control"]).not.toMatch(/public|s-maxage/);
  expect(ok.headers()["cdn-cache-control"]).toBe("no-store");
  await db.from("album_photos").update({ is_published: false }).eq("id", photoId);
  const gone = await page.request.get(`${BASE}/p/${photoId}/thumb`);
  expect(gone.status()).toBe(404);
  expect(gone.headers()["cache-control"]).toBe("no-store");
});
