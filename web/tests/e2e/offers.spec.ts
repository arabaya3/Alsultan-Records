import { expect, test } from "@playwright/test";
import { anon, BASE, db } from "./qa-helpers";

/**
 * Offers: active window by Asia/Hebron calendar day (inclusive), pinned first, price only when shown,
 * JSON-LD Offer only with a shown price, expired/future/draft/archived → real 404, home section.
 *   BASE_URL=http://localhost:3600 npx playwright test tests/e2e/offers.spec.ts --project=chromium
 * Fixtures via the SECRET key; dates relative to today in Asia/Hebron. Public pages are cached
 * (cacheLife minutes) so the spec polls until revalidation shows the fixtures, and cleans up after.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${t}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const P = "e2e-offer";
const F = {
  today: { slug: `${P}-today`, title: "عرض اختبار ينتهي اليوم", status: "published", starts_on: day(0), ends_on: day(0), show_price: true, price_minor: 150000, pinned_home: false, sort_order: 1 },
  pinned: { slug: `${P}-pinned`, title: "عرض اختبار مثبّت", status: "published", starts_on: null, ends_on: day(30), show_price: false, price_minor: 99900, pinned_home: true, sort_order: 50 },
  expired: { slug: `${P}-expired`, title: "عرض اختبار منتهي", status: "published", starts_on: day(-10), ends_on: day(-1), show_price: true, price_minor: 1000, pinned_home: true, sort_order: 0 },
  future: { slug: `${P}-future`, title: "عرض اختبار قادم", status: "published", starts_on: day(1), ends_on: null, show_price: false, price_minor: null, pinned_home: true, sort_order: 0 },
  draft: { slug: `${P}-draft`, title: "عرض اختبار مسودة", status: "draft", starts_on: null, ends_on: null, show_price: false, price_minor: null, pinned_home: true, sort_order: 0 },
  archived: { slug: `${P}-archived`, title: "عرض اختبار مؤرشف", status: "archived", starts_on: null, ends_on: null, show_price: false, price_minor: null, pinned_home: true, sort_order: 0 },
} as const;
const ids: Record<string, string> = {};
let offersSectionBefore = false;

async function html(p: string) {
  return (await fetch(new URL(p, BASE), { redirect: "manual" })).text();
}
async function until(p: string, pred: (h: string) => boolean, timeout = 200_000) {
  await expect.poll(async () => pred(await html(p)), { timeout, intervals: [3_000, 5_000, 10_000] }).toBe(true);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await db.from("offers").delete().like("slug", `${P}-%`);
  for (const [k, o] of Object.entries(F)) {
    const r = await db
      .from("offers")
      .insert({ ...o, description: `وصف ${o.title}`, terms: k === "today" ? "العرض ساري لليوم فقط.\nلا يُجمع مع عروض أخرى." : null, whatsapp_message: k === "today" ? "مرحباً، بدي عرض اليوم" : null })
      .select("id")
      .single();
    expect(r.error, k).toBeNull();
    ids[k] = r.data!.id;
  }
  await db.from("offer_items").insert([
    { offer_id: ids.today, label: "تصوير فوتوغرافي كامل", sort_order: 1 },
    { offer_id: ids.today, label: "فيلم العرس", sort_order: 2 },
  ]);
  offersSectionBefore = (await db.from("site_sections").select("is_visible").eq("key", "offers").single()).data?.is_visible ?? false;
  await db.from("site_sections").update({ is_visible: true }).eq("key", "offers");
  await until("/offers", (h) => h.includes(F.today.slug) && h.includes(F.pinned.slug));
  await until("/", (h) => h.includes('data-home-section="offers"'));
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  await db.from("offers").delete().like("slug", `${P}-%`);
  await db.from("site_sections").update({ is_visible: offersSectionBefore }).eq("key", "offers");
  await until("/offers", (h) => !h.includes(P));
  await until("/", (h) => !h.includes(P));
});

test("anon RLS returns exactly the active offers (inclusive Asia/Hebron window)", async () => {
  const { data, error } = await anon().from("offers").select("slug").like("slug", `${P}-%`);
  expect(error).toBeNull();
  expect((data ?? []).map((r) => r.slug).sort()).toEqual([F.pinned.slug, F.today.slug].sort());
  // Hidden price never reaches anon (display_price_minor is null unless show_price).
  const hidden = await anon().from("offers").select("display_price_minor").eq("slug", F.pinned.slug).single();
  expect(hidden.data?.display_price_minor).toBeNull();
  expect((await anon().from("offers").select("price_minor").limit(1)).error).not.toBeNull();
});

test("/offers lists active offers only, pinned first", async ({ page }) => {
  await page.goto("/offers");
  const slugs = await page.locator("[data-offer-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-offer-card")!));
  const mine = slugs.filter((s) => s.startsWith(P));
  expect(mine).toEqual([F.pinned.slug, F.today.slug]);
  for (const k of ["expired", "future", "draft", "archived"] as const) await expect(page.getByText(F[k].title)).toHaveCount(0);
});

test("offer page: Arabic dates, items, terms, price only when shown, JSON-LD Offer, WhatsApp message", async ({ page }) => {
  await page.goto(`/offers/${F.today.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(F.today.title);
  await expect(page.locator("[data-offer-price]")).toContainText("1,500 شيكل"); // ILS shows as «شيكل» (owner wording)
  const dates = (await page.locator("[data-offer-dates]").innerText()).trim();
  expect(dates).toMatch(/^من .+ حتى .+/);
  expect(dates).toMatch(/[٠-٩]/); // Arabic-Indic digits
  await expect(page.locator("[data-offer-items] li")).toHaveText(["تصوير فوتوغرافي كامل", "فيلم العرس"]);
  await expect(page.locator("[data-offer-terms]")).toContainText("لا يُجمع مع عروض أخرى.");
  const wa = await page.locator("main [data-whatsapp-cta]").last().getAttribute("href");
  expect(decodeURIComponent(wa!)).toContain("مرحباً، بدي عرض اليوم");
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const offer = ld.map((t) => JSON.parse(t)).find((j) => j["@type"] === "Offer");
  expect(offer).toMatchObject({ name: F.today.title, price: "1500.00", priceCurrency: "ILS", validFrom: F.today.starts_on, validThrough: F.today.ends_on });

  await page.goto(`/offers/${F.pinned.slug}`);
  await expect(page.locator("[data-offer-price]")).toHaveCount(0);
  const ld2 = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld2.map((t) => JSON.parse(t)).some((j) => j["@type"] === "Offer")).toBe(false);
  expect(await page.content()).not.toMatch(/999(\.00)?|٩٩٩/);
  const wa2 = await page.locator("main [data-whatsapp-cta]").last().getAttribute("href");
  expect(decodeURIComponent(wa2!)).toContain(`مرحباً، بدي أستفسر عن عرض: ${F.pinned.title}`);
});

test("expired / future / draft / archived / unknown offers → HTTP 404", async () => {
  for (const k of ["expired", "future", "draft", "archived"] as const) {
    expect((await fetch(new URL(`/offers/${F[k].slug}`, BASE), { redirect: "manual" })).status, k).toBe(404);
  }
  expect((await fetch(new URL("/offers/NOT_valid", BASE), { redirect: "manual" })).status).toBe(404);
  expect((await fetch(new URL(`/offers/${F.today.slug}`, BASE), { redirect: "manual" })).status).toBe(200);
});

test("home shows the offers section (pinned first) only while there are active offers", async ({ page }) => {
  await page.goto("/");
  const sec = page.locator('[data-home-section="offers"]');
  await expect(sec).toBeVisible();
  const slugs = (await sec.locator("[data-offer-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-offer-card")!))).filter((s) => s.startsWith(P));
  expect(slugs[0]).toBe(F.pinned.slug);
  expect(slugs).not.toContain(F.expired.slug);
  // Sitemap lists active offers only.
  await until("/sitemap.xml", (sm) => sm.includes(`/offers/${F.today.slug}`));
  expect(await html("/sitemap.xml")).not.toContain(`/offers/${F.expired.slug}`);
});
