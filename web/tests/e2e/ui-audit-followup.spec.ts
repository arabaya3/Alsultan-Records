import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BASE, db, newLoggedIn } from "./qa-helpers";

/**
 * UI audit follow-up (docs/ui-audit-followup.md) — regression tests for the behaviours this change introduced.
 * LOCAL STACK ONLY: temporary album/offer/nav rows are created with the secret key and removed afterwards.
 *   BASE_URL=http://localhost:3600 npx playwright test ui-audit-followup --project=chromium
 * Records short videos of the viewer and the photo-management screen into docs/screenshots/ui-audit/video.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(4 * 60_000);

const SHOTS = path.resolve(__dirname, "../../../docs/screenshots/ui-audit");
const VIDEO = path.join(SHOTS, "video");
const STAMP = Date.now().toString(36);
const ALBUM = { id: randomUUID(), slug: `qa-ui-${STAMP}`, title: "ألبوم اختبار الواجهة — عرس تجريبي 2026" };
const PHOTOS = [0, 1, 2].map((i) => ({ id: randomUUID(), alt: i === 0 ? "وصف كتبه المستخدم" : null }));
const OFFER = { id: randomUUID(), slug: `qa-offer-${STAMP}` };
const PRICED = { id: randomUUID(), slug: `qa-offer-priced-${STAMP}` };
const OFFER_TEXT = "1. تصوير سهرة العريس\n- كاميرا صور لتوثيق النقوط.\n- كاميرا فيديو لتوثيق النقوط.\n2. تصوير حمّام العريس\n- جلسة مع الأهل\n3. فيديو الحفلة كاملة\n4. ألبوم مطبوع\n5. فيلم قصير للمناسبة\n6. تسليم على فلاشة";
const uploaded: string[] = [];
let navAlbumsWasVisible: boolean | null = null;
let navContactWasVisible: boolean | null = null;

async function jpeg(i: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="${["#3a2f1e", "#1f2a33", "#2f1f2a"][i]}"/><circle cx="600" cy="400" r="200" fill="#c9a24a"/><text x="50%" y="90%" font-size="60" fill="#fff" text-anchor="middle" font-family="sans-serif">QA ${i + 1}</text></svg>`;
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
  await db.from("offer_items").delete().eq("offer_id", OFFER.id);
  await db.from("offers").delete().in("id", [OFFER.id, PRICED.id]);
  if (navAlbumsWasVisible !== null) await db.from("nav_items").update({ is_visible: navAlbumsWasVisible }).eq("target", "albums");
  if (navContactWasVisible !== null) await db.from("nav_items").update({ is_visible: navContactWasVisible }).eq("target", "contact");
}

test.beforeAll(async () => {
  fs.mkdirSync(VIDEO, { recursive: true });
  const { error: ae } = await db.from("photo_albums").insert({ id: ALBUM.id, slug: ALBUM.slug, title: ALBUM.title, is_published: true, sort_order: 1 });
  if (ae) throw new Error(ae.message);
  for (const [i, p] of PHOTOS.entries()) {
    const base = `albums/${ALBUM.id}/${p.id}`;
    const img = await jpeg(i);
    await put(`${base}/original.jpg`, img);
    await put(`${base}/display.jpg`, img);
    await put(`${base}/thumb.jpg`, await sharp(img).resize({ width: 480 }).jpeg().toBuffer());
    const { error } = await db.from("album_photos").insert({
      id: p.id,
      album_id: ALBUM.id,
      storage_path_original: `${base}/original.jpg`,
      variants: { thumb: `${base}/thumb.jpg`, display: `${base}/display.jpg` },
      width: 1200,
      height: 800,
      mime: "image/jpeg",
      alt_text: p.alt,
      sort_order: (i + 1) * 10,
      is_published: true,
      upload_status: "ready",
    });
    if (error) throw new Error(error.message);
  }
  await db.from("photo_albums").update({ cover_photo_id: PHOTOS[0].id }).eq("id", ALBUM.id);
  const { error: oe } = await db.from("offers").insert({ id: OFFER.id, slug: OFFER.slug, title: "عرض اختبار القوائم", description: OFFER_TEXT, status: "published", currency: "ILS", show_price: false });
  if (oe) throw new Error(oe.message);
  const { error: pe } = await db.from("offers").insert({ id: PRICED.id, slug: PRICED.slug, title: "عرض بسعر ظاهر", description: "وصف قصير", status: "published", currency: "ILS", show_price: true, price_minor: 150000 });
  if (pe) throw new Error(pe.message);
  const nav = (await db.from("nav_items").select("target, is_visible").in("target", ["albums", "contact"])).data ?? [];
  navAlbumsWasVisible = nav.find((n) => n.target === "albums")?.is_visible ?? null;
  navContactWasVisible = nav.find((n) => n.target === "contact")?.is_visible ?? null;
  await db.from("nav_items").update({ is_visible: true }).in("target", ["albums", "contact"]);
});
test.afterAll(cleanup);

/** Cached public pages pick up direct DB writes within the cache window: retry the navigation until they do. */
async function gotoUntil(page: Page, url: string, ready: (p: Page) => Promise<void>) {
  await expect(async () => {
    await page.goto(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`);
    await ready(page);
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000] });
}

test("UA1 offers: list-shaped description keeps its structure — card preview + «بنود أخرى», full ordered list on the page", async ({ page }) => {
  await gotoUntil(page, "/offers", async (p) => expect(p.locator(`[data-offer-card='${OFFER.slug}']`)).toBeVisible({ timeout: 2_000 }));
  const card = page.locator(`[data-offer-card='${OFFER.slug}']`);
  await expect(card.locator("[data-offer-preview] li")).toHaveCount(4);
  await expect(card.locator("[data-offer-preview] li").first()).toHaveText("تصوير سهرة العريس");
  await expect(card.locator("[data-offer-more]")).toContainText("٢");
  // prices untouched by this change: hidden price → no price; shown price → the same «1,500 شيكل» format as before
  await expect(card.locator("[data-offer-price]")).toHaveCount(0);
  await expect(page.locator(`[data-offer-card='${PRICED.slug}'] [data-offer-price]`)).toHaveText("1,500 شيكل");
  await page.screenshot({ path: path.join(SHOTS, "after", "offers-local-1440.png"), fullPage: true });
  await card.click();
  const desc = page.locator("[data-offer-description]");
  await expect(desc.locator(":scope > ol > li")).toHaveCount(6);
  await expect(desc.locator(":scope > ol > li").first().locator("ul > li")).toHaveCount(2);
  for (const line of OFFER_TEXT.split("\n")) await expect(desc).toContainText(line.replace(/^\s*(\d+\.|-)\s+/, ""));
  // One page heading: the visible h1 (after a client navigation Next keeps the previous page hidden in the DOM, out
  // of the accessibility tree) and exactly one h1 in the page's own HTML.
  await expect(page.locator("h1:visible")).toHaveCount(1);
  const html = await (await page.request.get(`/offers/${OFFER.slug}`)).text();
  expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
});

test("UA2 nav: /work?tab=photos marks «ألبومات الصور» only; back/forward and tabs update it; contact one click (header, footer, mobile)", async ({ page, browser }) => {
  const nav = page.getByRole("navigation", { name: "القائمة الرئيسية" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoUntil(page, "/work?tab=photos", async (p) => expect(p.getByRole("navigation", { name: "القائمة الرئيسية" }).locator('a[href="/work?tab=photos"]')).toHaveCount(1, { timeout: 2_000 }));
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav.locator('a[href="/work?tab=photos"]')).toHaveAttribute("aria-current", "page");
  await page.locator("[data-work-tab='videos']").click();
  await expect(page).toHaveURL(/\/work(\?|$)/);
  await expect(nav.locator('a[href="/work"]')).toHaveAttribute("aria-current", "page");
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await page.goBack();
  await expect(nav.locator('a[href="/work?tab=photos"]')).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(nav.locator('a[href="/work"]')).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(nav.locator('a[href="/work"]')).toHaveAttribute("aria-current", "page");
  // footer: contact always one click away
  await expect(page.locator("footer").getByRole("link", { name: "تواصل معنا" })).toHaveAttribute("href", "/contact");
  // mobile menu
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto(`${BASE}/work?tab=photos`);
  await m.getByRole("button", { name: /القائمة/ }).first().click();
  const menu = m.getByRole("navigation", { name: "القائمة الرئيسية" }).last();
  await expect(menu.locator('a[href="/contact"]')).toBeVisible();
  await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(menu.locator('a[href="/work?tab=photos"]')).toHaveAttribute("aria-current", "page");
  await m.close();
});

test("UA3 /work: one h1 in the HTML; the lead fits the tab (category guidance only on videos)", async ({ page, request }) => {
  for (const q of ["", "?tab=photos", "?tab=promos"]) {
    const html = await (await request.get(`/work${q}`)).text();
    expect((html.match(/<h1[\s>]/g) ?? []).length, `h1 count /work${q}`).toBe(1);
  }
  await page.goto("/work");
  await expect(page.locator("main")).toContainText("اختر تصنيفاً");
  await page.goto("/work?tab=photos");
  await expect(page.locator("main")).toContainText("افتح أي ألبوم");
  await expect(page.locator("main")).not.toContainText("اختر تصنيفاً");
});

test("UA4 viewer: visible loading, error + retry recovers, fast arrows show the right photo, only neighbours preloaded, focus fallback", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const displayRequests: string[] = [];
  // Photo 2 fails (preload included) until the visitor presses «إعادة المحاولة».
  let failPhoto2 = true;
  await page.route("**/p/*/display*", async (route) => {
    const url = route.request().url();
    displayRequests.push(url);
    if (url.includes(PHOTOS[1].id) && failPhoto2) return route.fulfill({ status: 500, body: "boom" });
    await new Promise((r) => setTimeout(r, url.includes(PHOTOS[0].id) ? 1500 : 200)); // slow network for the first photo
    await route.continue();
  });
  await gotoUntil(page, `/work/albums/${ALBUM.slug}`, async (p) => expect(p.locator(`[data-album-photo='${PHOTOS[0].id}']`)).toBeVisible({ timeout: 2_000 }));
  displayRequests.length = 0;
  await page.locator(`[data-album-photo='${PHOTOS[0].id}']`).click();
  const lb = page.getByTestId("lightbox");
  await expect(lb.locator("[data-lightbox-loading]")).toContainText("جارِ تحميل الصورة");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden"); // scroll locked while open
  await expect(lb.locator(`[data-lightbox-image='${PHOTOS[0].id}']`)).toHaveCSS("opacity", "1", { timeout: 10_000 });
  // neighbours only: the opened photo + the next one (no previous on the first), never the whole album at once
  await expect.poll(() => new Set(displayRequests.map((u) => u.split("/p/")[1].split("/")[0])).size).toBeLessThanOrEqual(2);
  // next photo fails once → error with retry → recovers
  await page.keyboard.press("ArrowLeft"); // RTL: ← = next
  await expect(lb.locator("[data-lightbox-error]")).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "after", "lightbox-error-1440.png") });
  failPhoto2 = false;
  await lb.locator("[data-lightbox-retry]").click();
  await expect(lb.locator(`[data-lightbox-image='${PHOTOS[1].id}']`)).toHaveCSS("opacity", "1", { timeout: 10_000 });
  // fast navigation: the shown photo always matches the counter
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(lb).toContainText("3 من 3");
  await expect(lb.locator(`[data-lightbox-image='${PHOTOS[2].id}']`)).toBeVisible();
  await expect(lb.locator(`[data-lightbox-image]`)).toHaveCount(1);
  // Esc closes; focus returns to the opener
  await page.keyboard.press("Escape");
  await expect(lb).toHaveCount(0);
  await expect(page.locator(`[data-album-photo='${PHOTOS[0].id}']`)).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(""); // and released on close
  // opener removed while open → focus falls back to the current photo's grid item (not <body>)
  await page.locator(`[data-album-photo='${PHOTOS[1].id}']`).click();
  await expect(lb).toBeVisible();
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-album-photo="${id}"]`);
    el?.replaceWith(el.cloneNode(true)); // the original opener node is gone
  }, PHOTOS[1].id);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? "")).not.toBe("BODY");
  // hero «عرض الشرائح» still opens the viewer
  const slideshow = page.locator("[data-album-slideshow]").first();
  if (await slideshow.count()) {
    await slideshow.click();
    await expect(lb).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await ctx.close();
});

test("UA5 admin categories + album: visible labels; slug suggested for a NEW item, never changed for an existing one", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/albums");
  const create = page.getByTestId("album-category-create");
  await create.getByLabel("عنوان التصنيف").fill("حفلات تخرج");
  await expect(create.getByTestId("album-category-slug")).toHaveValue("hflat-tkhrj");
  await create.getByTestId("album-category-slug").fill("graduations-qa-" + STAMP);
  await create.getByLabel("عنوان التصنيف").fill("حفلات تخرج ٢٠٢٧"); // edited by hand → no longer follows the title
  await expect(create.getByTestId("album-category-slug")).toHaveValue("graduations-qa-" + STAMP);
  await create.getByRole("button", { name: "إضافة تصنيف" }).click();
  await expect(page.locator(`[data-testid=album-category-row][data-slug="graduations-qa-${STAMP}"]`)).toHaveCount(1);
  // the same slug again → the server refuses it clearly; what was typed stays in the form
  await create.getByLabel("عنوان التصنيف").fill("نسخة ثانية");
  await create.getByTestId("album-category-slug").fill("graduations-qa-" + STAMP);
  await create.getByRole("button", { name: "إضافة تصنيف" }).click();
  await expect(create.getByTestId("action-msg")).toContainText("مستخدم");
  await expect(create.getByTestId("album-category-slug")).toHaveValue("graduations-qa-" + STAMP);
  await expect(page.locator(`[data-testid=album-category-row][data-slug="graduations-qa-${STAMP}"]`)).toHaveCount(1);
  await db.from("album_categories").delete().eq("slug", "graduations-qa-" + STAMP);
  // existing album: title edit leaves the slug alone
  await page.goto(`${BASE}/admin/albums/${ALBUM.id}`);
  const slug = page.getByTestId("album-slug");
  await expect(slug).toHaveValue(ALBUM.slug);
  await page.locator('input[name="title"]').first().fill("عنوان جديد للاختبار");
  await expect(slug).toHaveValue(ALBUM.slug);
  // Arabic file chooser: real input still reachable by keyboard
  await expect(page.locator("[data-file-picker-button]").first()).toHaveText(/اختيار الصور/);
  await page.getByTestId("album-upload-input").focus();
  await expect(page.getByTestId("album-upload-input")).toBeFocused();
  await page.getByTestId("album-upload-input").setInputFiles({ name: "قاعة-١.jpg", mimeType: "image/jpeg", buffer: await jpeg(0) });
  await expect(page.locator("[data-file-picker-status]").first()).toContainText("قاعة-١.jpg");
  await page.context().close();
});

test("UA6 album photos: one list (details / order views), «الغلاف الحالي», bulk alt save with a partial failure keeps input, trash asks first", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: VIDEO, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const { uiLogin } = await import("./qa-helpers");
  await uiLogin(page, "owner", `/admin/albums/${ALBUM.id}`);
  await page.goto(`${BASE}/admin/albums/${ALBUM.id}`);
  // details view: no separate reorder grid at the same time
  await expect(page.getByTestId("album-photos")).toBeVisible();
  await expect(page.getByTestId("photo-reorder")).toBeHidden();
  await expect(page.locator(`[data-testid=album-photo][data-photo-id="${PHOTOS[0].id}"] [data-testid=photo-cover-badge]`)).toHaveText("الغلاف الحالي");
  // the user's own alt text is shown as is (never replaced)
  await expect(page.locator(`[data-testid=photo-alt][data-photo-id="${PHOTOS[0].id}"]`)).toHaveValue("وصف كتبه المستخدم");
  const alt1 = page.locator(`[data-testid=photo-alt][data-photo-id="${PHOTOS[1].id}"]`);
  const alt2 = page.locator(`[data-testid=photo-alt][data-photo-id="${PHOTOS[2].id}"]`);
  await alt1.fill("نص بديل للصورة الثانية");
  // over the 300-character limit (set programmatically, past the input's maxLength) → the server refuses this one row
  const tooLong = "و".repeat(301);
  await alt2.evaluate((el) => el.removeAttribute("maxlength"));
  await alt2.fill(tooLong);
  await expect(page.getByTestId("bulk-alt-bar")).toHaveAttribute("data-dirty", "2");
  await page.getByTestId("bulk-alt-save").click();
  await expect(page.getByTestId("bulk-alt-msg")).toHaveAttribute("data-ok", "0");
  await expect(page.getByTestId("bulk-alt-msg")).toContainText("حُفظ 1 من 2");
  await expect(page.getByTestId("photo-alt-error")).toHaveCount(1);
  await expect(page.getByTestId("photo-alt-error")).toContainText("300");
  await expect(alt2).toHaveValue(tooLong); // what was typed is kept
  await expect(alt2).toHaveAttribute("aria-invalid", "true");
  expect((await db.from("album_photos").select("alt_text").eq("id", PHOTOS[1].id).single()).data!.alt_text).toBe("نص بديل للصورة الثانية");
  expect((await db.from("album_photos").select("alt_text").eq("id", PHOTOS[0].id).single()).data!.alt_text).toBe("وصف كتبه المستخدم");
  await expect(page.getByTestId("bulk-alt-bar")).toHaveAttribute("data-dirty", "1");
  // switching views keeps unsaved text (both views stay mounted)
  await page.getByTestId("photo-view-order").click();
  await page.getByTestId("photo-view-details").click();
  await expect(alt2).toHaveValue(tooLong);
  // someone else edits photo 2 meanwhile → saving does NOT overwrite it: conflict, current text shown, typed text kept
  await alt1.fill("نصي الجديد للصورة الثانية");
  await db.from("album_photos").update({ alt_text: "تعديل من تبويب آخر" }).eq("id", PHOTOS[1].id);
  await alt2.fill("نص بديل للصورة الثالثة");
  await page.getByTestId("bulk-alt-save").click();
  await expect(page.getByTestId("bulk-alt-msg")).toContainText("حُفظ 1 من 2");
  await expect(page.getByTestId("photo-alt-conflict")).toContainText("تعديل من تبويب آخر");
  await expect(alt1).toHaveValue("نصي الجديد للصورة الثانية");
  expect((await db.from("album_photos").select("alt_text").eq("id", PHOTOS[1].id).single()).data!.alt_text).toBe("تعديل من تبويب آخر");
  expect((await db.from("album_photos").select("alt_text").eq("id", PHOTOS[2].id).single()).data!.alt_text).toBe("نص بديل للصورة الثالثة");
  await page.screenshot({ path: path.join(SHOTS, "after", "admin-alt-conflict-1280.png"), fullPage: true });
  // a deliberate second save (after seeing the current text) is applied
  await page.getByTestId("bulk-alt-save").click();
  await expect(page.getByTestId("bulk-alt-msg")).toHaveAttribute("data-ok", "1");
  expect((await db.from("album_photos").select("alt_text").eq("id", PHOTOS[1].id).single()).data!.alt_text).toBe("نصي الجديد للصورة الثانية");
  await page.screenshot({ path: path.join(SHOTS, "after", "admin-album-photos-1280.png"), fullPage: true });
  // legacy text stored with stray spaces is still saveable (the baseline is compared exactly, not trimmed)
  await db.from("album_photos").update({ alt_text: "  نص قديم بمسافات  " }).eq("id", PHOTOS[2].id);
  await page.reload();
  await alt2.fill("نص جديد بعد القديم");
  await page.getByTestId("bulk-alt-save").click();
  await expect(page.getByTestId("bulk-alt-msg")).toHaveAttribute("data-ok", "1");
  await expect(page.getByTestId("photo-alt-conflict")).toHaveCount(0);
  expect((await db.from("album_photos").select("alt_text").eq("id", PHOTOS[2].id).single()).data!.alt_text).toBe("نص جديد بعد القديم");
  // trash: explicit confirmation, nothing happens before it
  await page.locator(`[data-testid=album-photo][data-photo-id="${PHOTOS[1].id}"]`).getByTestId("photo-trash").getByRole("button").click();
  await expect(page.locator("dialog[open]")).toContainText("نقل الصورة");
  expect((await db.from("album_photos").select("deleted_at").eq("id", PHOTOS[1].id).single()).data!.deleted_at).toBeNull();
  await page.locator("dialog[open]").getByRole("button", { name: /إلغاء|تراجع/ }).click();
  expect((await db.from("album_photos").select("deleted_at").eq("id", PHOTOS[1].id).single()).data!.deleted_at).toBeNull();
  // order view: keyboard reorder + save
  await page.getByTestId("photo-view-order").click();
  await expect(page.getByTestId("album-photos")).toBeHidden();
  await expect(page).toHaveURL(/view=order/);
  const first = page.locator(`[data-testid=photo-reorder] li[data-photo-id="${PHOTOS[1].id}"] [data-move="up"]`);
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(`[data-testid=photo-reorder] li`).first()).toHaveAttribute("data-photo-id", PHOTOS[1].id);
  await page.getByTestId("photo-reorder-save").click();
  await expect.poll(async () => (await db.from("album_photos").select("id").eq("album_id", ALBUM.id).is("deleted_at", null).order("sort_order")).data?.[0]?.id).toBe(PHOTOS[1].id);
  await ctx.close();
});

test("UA7 mobile + tablet widths: no horizontal overflow on the changed pages", async ({ browser }) => {
  for (const width of [320, 390, 768, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    for (const url of ["/offers", `/offers/${OFFER.slug}`, "/work?tab=photos", `/work/albums/${ALBUM.slug}`, "/services", "/privacy", "/contact"]) {
      await page.goto(url);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${url} @${width}`).toBeLessThanOrEqual(0);
    }
    await page.close();
  }
});
