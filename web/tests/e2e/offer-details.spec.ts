import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, newLoggedIn, overflowPx, skipSiteIntro } from "./qa-helpers";

/**
 * OD — offer details page layout (fix/production-presentation). LOCAL STACK ONLY: temporary offers, removed afterwards.
 *   BASE_URL=http://localhost:3600 npx playwright test offer-details --project=chromium
 * Guards the defects fixed here: no line of the owner's description is lost or reordered by the section layout, the
 * deliveries/gifts section is set apart only when the owner wrote it, no empty image column, hidden prices stay hidden.
 * The offer page reads the cached active-offers list (cacheLife minutes; admin saves expire it, direct DB inserts do
 * not), so a fixture inserted here 404s until that entry revalidates: beforeAll polls the page HTML, like offers.spec.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const STAMP = Date.now().toString(36);
// Same shape as the live «الباقة الفضية» (wording made up): numbered coverage with details, then deliveries/gifts.
const SILVER_TEXT =
  "1. تغطية حفلة السهرة\n- مصوّر فوتوغرافي للحفلة كاملة.\n- مصوّر فيديو للنقوط.\n2. تغطية تجهيز العريس\n- كاميرا فيديو بمثبّت حركة.\n3. تغطية قاعة الرجال\n- مصوّر فيديو.\n\nالتسليمات والهدايا\n- طباعة 40 صورة.\n- ألبوم مطبوع.\n- فيديو قصير هدية.";
const LONG_TEXT =
  "فقرة أولى فيها كلمة طويلة جدًا: ابببببببببببببببببببببببببببببببببببببببببببببببببببببببب ثم تكمل.\n\n• بند منقّط https://example.com/a/very/long/link/that/should/wrap/inside/the/page\n\nملاحظة أخيرة غير معروفة البنية 🙂";
const SILVER = { id: randomUUID(), slug: `qa-od-silver-${STAMP}`, title: "🥈 باقة اختبار التفاصيل" };
const LONG = { id: randomUUID(), slug: `qa-od-long-${STAMP}`, title: "عرض اختبار نص حر" };
const ADMIN = { slug: `qa-od-admin-${STAMP}`, title: `عرض من الإدارة ${STAMP}` };

/** The text a visitor reads, line by line, with list markers removed (what must survive the layout). */
const lines = (t: string) => t.split("\n").map((l) => l.replace(/^\s*(\d{1,3}[.)]|[-•*])\s+/, "").trim()).filter(Boolean);

test.beforeAll(async () => {
  const rows = [
    { ...SILVER, description: SILVER_TEXT, show_price: false, price_minor: 250000 },
    { ...LONG, description: LONG_TEXT, show_price: false, price_minor: null },
  ];
  for (const r of rows) {
    const { error } = await db.from("offers").insert({ ...r, status: "published", currency: "ILS" });
    if (error) throw new Error(error.message);
  }
});
test.beforeAll(async ({ request }) => {
  await until(request, SILVER.slug);
  await until(request, LONG.slug);
});
/** Polls until the cached offers list includes the fixture (stale-while-revalidate brings it in). */
async function until(request: import("@playwright/test").APIRequestContext, slug: string) {
  await expect
    .poll(async () => (await (await request.get(`/offers/${slug}`)).text()).includes("data-offer-description"), { timeout: 240_000, intervals: [3_000, 5_000, 10_000] })
    .toBe(true);
}

test.afterAll(async () => {
  await db.from("offers").delete().in("id", [SILVER.id, LONG.id]);
  await db.from("offers").delete().eq("slug", ADMIN.slug);
});

async function open(page: Page, slug: string, width: number) {
  await skipSiteIntro(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/offers/${slug}`);
  await expect(page.locator("[data-offer-description]")).toBeVisible();
}

test("OD1 every line of a sectioned description is shown once, in the owner's order", async ({ page }) => {
  await open(page, SILVER.slug, 1440);
  const shown = (await page.locator("[data-offer-description]").innerText()).replace(/[٠-٩\d]+\.\s*/g, "");
  let at = -1;
  for (const l of lines(SILVER_TEXT)) {
    const i = shown.indexOf(l, at + 1);
    expect(i, `«${l}» shown after the previous line`).toBeGreaterThan(at);
    at = i;
  }
  // each section heading sits with its own items
  const deliveries = page.locator("[data-offer-section='التسليمات والهدايا']");
  await expect(deliveries.locator("h3")).toHaveText("التسليمات والهدايا");
  await expect(deliveries.locator("li")).toHaveText(["طباعة 40 صورة.", "ألبوم مطبوع.", "فيديو قصير هدية."]);
  await expect(page.locator("[data-offer-section='تغطية حفلة السهرة'] li")).toHaveCount(2);
});

test("OD2 deliveries/gifts set apart; coverage in two columns on desktop, one on phones; no empty image column", async ({ page }) => {
  await open(page, SILVER.slug, 1440);
  await expect(page.locator("[data-offer-section][data-accent]")).toHaveCount(1);
  await expect(page.locator("[data-offer-section][data-accent]")).toHaveAttribute("data-offer-section", "التسليمات والهدايا");
  const boxes = async () => page.locator("[data-offer-section]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) })));
  const desk = await boxes();
  expect(desk[0].y).toBe(desk[1].y); // first two services side by side
  expect(desk[0].x).toBeGreaterThan(desk[1].x); // RTL: the first one on the right
  const page1440 = await page.locator("[data-offer-description]").evaluate((e) => e.getBoundingClientRect().width);
  expect(page1440).toBeGreaterThan(1440 * 0.8); // the description uses the width (no reserved column for a missing image)
  await expect(page.locator("[data-offer-price]")).toHaveCount(0); // show_price=false stays hidden
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await boxes();
  for (let i = 1; i < phone.length; i++) expect(phone[i].y).toBeGreaterThan(phone[i - 1].y); // one column, in order
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
});

test("OD3 free text (paragraphs, bullets, long words, emoji) stays plain, complete and inside the page at 320px", async ({ page }) => {
  await open(page, LONG.slug, 320);
  await expect(page.locator("[data-offer-section]")).toHaveCount(0);
  const shown = await page.locator("[data-offer-description]").innerText();
  for (const l of lines(LONG_TEXT)) expect(shown).toContain(l);
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  // the header action is there even without price or dates
  await expect(page.getByRole("link", { name: /اسأل عن العرض على واتساب/ }).first()).toBeVisible();
});

test("OD4 an offer published from the admin is on the public page at once — the save expires the offers cache", async ({ browser, request }) => {
  // warm the cached active-offers list first, so a stale entry would hide the new offer
  expect((await request.get("/offers")).ok()).toBe(true);
  expect((await request.get(`/offers/${SILVER.slug}`)).ok()).toBe(true);
  const admin = await newLoggedIn(browser, "admin", "/admin/content/offers/new");
  const form = admin.getByTestId("offer-form");
  await form.locator('input[name="title"]').fill(ADMIN.title);
  await admin.getByTestId("slug-hint").fill(ADMIN.slug.replace(/-/g, " "));
  await form.locator('[name="description"]').fill(SILVER_TEXT);
  await form.getByRole("button", { name: "معاينة" }).click();
  await admin.waitForURL(/\/preview$/);
  await admin.getByRole("button", { name: "نشر" }).click();
  await expect.poll(async () => (await db.from("offers").select("status").eq("slug", ADMIN.slug).maybeSingle()).data?.status).toBe("published");
  // one request each, no polling for revalidation: the admin action's updateTag must already have expired the entry
  const html = await (await request.get(`/offers/${ADMIN.slug}`)).text();
  expect(html).toContain("data-offer-description");
  expect(html).toContain("التسليمات والهدايا");
  expect(await (await request.get("/offers")).text()).toContain(ADMIN.title);
  await admin.context().close();
});

// The four combinations of a shown price and an image, each with a sectioned description.
const CASES = [
  { key: "price-image", price: true, image: true },
  { key: "price-no-image", price: true, image: false },
  { key: "image-no-price", price: false, image: true },
  { key: "no-image-no-price", price: false, image: false },
].map((c) => ({ ...c, id: randomUUID(), slug: `qa-od-${c.key}-${STAMP}` }));
const CASE_SHOTS = path.resolve(__dirname, "../../../docs/screenshots/production-presentation/cases");

test("OD5 price × image: no empty column, image/text/actions whole on phone and desktop", async ({ page, request }) => {
  test.setTimeout(400_000);
  // a photo that is already public (published, in a published album) — the offer only points at it
  const { data: ph } = await db.from("album_photos").select("id, photo_albums!inner(is_published)").eq("is_published", true).eq("upload_status", "ready").eq("photo_albums.is_published", true).limit(1);
  const photo = ph?.[0]?.id;
  test.skip(!photo, "needs one published local photo");
  for (const c of CASES) {
    const { error } = await db.from("offers").insert({ id: c.id, slug: c.slug, title: `عرض ${c.key}`, description: SILVER_TEXT, status: "published", currency: "ILS", show_price: c.price, price_minor: 180000, image_photo_id: c.image ? photo : null, starts_on: "2026-01-01", ends_on: "2099-12-31" });
    if (error) throw new Error(error.message);
  }
  try {
    for (const c of CASES) await until(request, c.slug);
    fs.mkdirSync(CASE_SHOTS, { recursive: true });
    await skipSiteIntro(page);
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: w < 800 ? 844 : 900 });
      for (const c of CASES) {
        await page.goto(`/offers/${c.slug}`);
        await expect(page.locator("[data-offer-description]")).toBeVisible();
        await expect(page.locator("[data-offer-price]")).toHaveCount(c.price ? 1 : 0);
        await expect(page.locator("[data-offer-price]").or(page.locator("[data-offer-dates]")).first()).toBeVisible();
        const img = page.locator("main img[src*='/display']");
        await expect(img).toHaveCount(c.image ? 1 : 0);
        const desc = await page.locator("[data-offer-description]").boundingBox();
        if (c.image) {
          await img.scrollIntoViewIfNeeded();
          await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
          const ib = (await img.boundingBox())!;
          expect(ib.x).toBeGreaterThanOrEqual(0);
          expect(ib.x + ib.width).toBeLessThanOrEqual(w + 0.5); // the whole picture inside the page
          if (w >= 1024) expect(desc!.width).toBeGreaterThan(w * 0.4); // two filled columns: text + picture
        } else {
          expect(desc!.width).toBeGreaterThan(w * (w >= 1024 ? 0.8 : 0.85)); // no reserved empty column
        }
        for (const a of await page.getByRole("link", { name: /اسأل عن العرض على واتساب/ }).all()) {
          const b = (await a.boundingBox())!;
          expect(b.height).toBeGreaterThanOrEqual(44);
          expect(b.x + b.width).toBeLessThanOrEqual(w + 0.5);
        }
        expect(await overflowPx(page), `${c.key} @${w}`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: path.join(CASE_SHOTS, `${c.key}-${w}.png`), fullPage: true });
      }
    }
  } finally {
    await db.from("offers").delete().in("id", CASES.map((c) => c.id));
  }
});
