import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db, overflowPx, skipSiteIntro } from "./qa-helpers";

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
