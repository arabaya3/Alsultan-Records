import { expect, test, type Browser, type Page } from "@playwright/test";
import { BASE, db, newLoggedIn } from "./qa-helpers";

/**
 * Packages (permanent bundles) vs offers (time-limited): separate admin + pages, optional offer→package link that
 * never changes the package, offer order by target period (not by title), pinning, expiry, WhatsApp texts,
 * desktop + mobile nav, permissions. Everything is created and deleted THROUGH THE ADMIN (cache invalidated).
 *   BASE_URL=http://localhost:3600 npx playwright test packages-offers
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const S = Date.now().toString(36);
const PKG = { title: `بكج اختبار ${S}`, slug: `e2e-pkg-${S}` };
// Titles deliberately name a DIFFERENT month than the target: ordering must use the target, never the title.
const OFFERS = [
  { key: "sep26", title: `عرض أكتوبر اسماً ${S}`, month: "9", year: "2026" },
  { key: "oct26", title: `عرض سبتمبر اسماً ${S}`, month: "10", year: "2026" },
  { key: "sep27", title: `عرض أيلول 2027 ${S}`, month: "9", year: "2027" },
  { key: "pinned", title: `عرض مثبت قديم ${S}`, month: "1", year: "2025", pin: true },
  { key: "future", title: `عرض مستقبلي ${S}`, month: "11", year: "2026", future: true },
] as const;
const slugOf = (k: string) => `e2e-off-${k}-${S}`;
const hebronDay = (delta: number) => {
  const d = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron" }).format(new Date()));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const html = async (path: string) => (await fetch(`${BASE}${path}`)).text();
const ids: Record<string, string> = {};
let pkgId = "";
let admin: Page;

async function adminPage(browser: Browser) {
  admin ??= await newLoggedIn(browser, "admin", "/admin/content/packages");
  return admin;
}

async function adminDelete(page: Page, path: string, label: string) {
  await page.goto(`${BASE}${path}`);
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(path.split("/").pop()!));
}

test.afterAll(async () => {
  // Through the admin (cache invalidation); DB sweep only as a last resort for anything a failed step left.
  if (admin) {
    for (const o of OFFERS) if (ids[o.key]) await adminDelete(admin, `/admin/content/offers/${ids[o.key]}`, "حذف العرض نهائياً").catch(() => {});
    if (pkgId) await adminDelete(admin, `/admin/content/packages/${pkgId}`, "حذف البكج نهائياً").catch(() => {});
    await admin.context().close();
  }
  await db.from("offers").delete().like("slug", `e2e-off-%-${S}`);
  await db.from("packages").delete().eq("slug", PKG.slug);
});

test("K1: admin creates a package (services, price, featured) → /packages, WhatsApp names the package", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/content/packages/new`);
  const form = page.getByTestId("package-form");
  await form.locator('input[name="title"]').fill(PKG.title);
  await page.getByTestId("slug-hint").fill(PKG.slug.replace(/-/g, " "));
  await form.locator('textarea[name="description"]').fill("وصف بكج الاختبار.");
  await form.locator('input[name="items"]').first().fill("تصوير فوتوغرافي");
  await form.getByRole("button", { name: "+ إضافة بند" }).click();
  await form.locator('input[name="items"]').nth(1).fill("فيلم العرس");
  await form.locator('input[name="price"]').fill("3000");
  await form.locator('input[name="show_price"]').check();
  await form.locator('input[name="featured"]').check();
  await form.getByRole("button", { name: "نشر" }).click();
  await page.waitForURL(/\/admin\/content\/packages\/[0-9a-f-]{36}/);
  pkgId = page.url().match(/packages\/([0-9a-f-]{36})/)![1];

  await expect.poll(async () => (await html("/packages")).includes(PKG.title), { timeout: 15_000 }).toBe(true);
  const pub = await browser.newPage();
  await pub.goto(`${BASE}/packages`);
  const card = pub.locator(`[data-package-card="${PKG.slug}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator("[data-package-items] li")).toHaveText(["تصوير فوتوغرافي", "فيلم العرس"]);
  await expect(card.locator("[data-package-price]")).toBeVisible();
  await expect(card.locator("[data-package-featured]")).toHaveText("مميّز");
  const wa = await card.locator('a[href^="https://wa.me/"]').getAttribute("href");
  expect(decodeURIComponent(new URL(wa!).searchParams.get("text")!)).toBe(`مرحباً، بدي أستفسر عن بكج: ${PKG.title}`);
  // A package is not an offer: it never appears on /offers.
  expect(await html("/offers")).not.toContain(PKG.title);
  await pub.close();
});

test("K2: offers ordered by target period across years, pinned first, future hidden; title never used", async ({ browser }) => {
  const page = await adminPage(browser);
  for (const o of OFFERS) {
    await page.goto(`${BASE}/admin/content/offers/new`);
    const form = page.getByTestId("offer-form");
    await form.locator('input[name="title"]').fill(o.title);
    await page.getByTestId("slug-hint").fill(slugOf(o.key).replace(/-/g, " "));
    await form.locator('input[name="items"]').first().fill("بند");
    await form.getByTestId("offer-target-month").selectOption(o.month);
    await form.getByTestId("offer-target-year").fill(o.year);
    if ("future" in o) await form.locator('input[name="starts_on"]').fill(hebronDay(1));
    if ("pin" in o) await form.locator('input[name="pinned_home"]').check();
    if (o.key === "oct26") await form.getByTestId("offer-package").selectOption(pkgId);
    await form.getByRole("button", { name: "نشر" }).click();
    await page.waitForURL(/\/admin\/content\/offers\/[0-9a-f-]{36}/);
    ids[o.key] = page.url().match(/offers\/([0-9a-f-]{36})/)![1];
  }
  const order = async () => {
    const h = await html("/offers");
    return [...h.matchAll(/data-offer-card="(e2e-off-[a-z0-9]+-[a-z0-9]+)"/g)].map((m) => m[1]).filter((s) => s.endsWith(`-${S}`));
  };
  await expect.poll(order, { timeout: 20_000 }).toEqual([slugOf("pinned"), slugOf("sep27"), slugOf("oct26"), slugOf("sep26")]);
  // Future offer: not on /offers, its page 404s; it stays in the admin as «مجدول».
  expect((await fetch(`${BASE}/offers/${slugOf("future")}`)).status).toBe(404);
  await page.goto(`${BASE}/admin/content/offers?filter=scheduled`);
  await expect(page.getByTestId("offer-row").filter({ hasText: OFFERS[4].title })).toBeVisible();
});

test("K3: linked offer shows the package; editing and expiring the offer never changes the package", async ({ browser }) => {
  const pub = await browser.newPage();
  await pub.goto(`${BASE}/offers`);
  await expect(pub.locator(`[data-offer-card="${slugOf("oct26")}"] [data-offer-package]`)).toContainText(PKG.title);
  await pub.goto(`${BASE}/offers/${slugOf("oct26")}`);
  await expect(pub.locator("[data-offer-package] a")).toHaveAttribute("href", `/packages#${PKG.slug}`);
  const wa = await pub.locator('main a[href^="https://wa.me/"]').first().getAttribute("href");
  expect(decodeURIComponent(new URL(wa!).searchParams.get("text")!)).toContain(OFFERS[1].title);

  const before = (await db.from("packages").select("title, status, price_minor, featured, updated_at").eq("id", pkgId).single()).data;
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/content/offers/${ids.oct26}`);
  const form = page.getByTestId("offer-form");
  await form.locator('input[name="title"]').fill(`${OFFERS[1].title} معدّل`);
  await form.locator('input[name="starts_on"]').fill("");
  await form.locator('input[name="ends_on"]').fill(hebronDay(-1));
  await form.getByRole("button", { name: "حفظ (منشور)" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  // Expired: gone from /offers and its page 404s, kept in the admin as «منتهي».
  await expect.poll(async () => (await html("/offers")).includes(slugOf("oct26")), { timeout: 15_000 }).toBe(false);
  expect((await fetch(`${BASE}/offers/${slugOf("oct26")}`)).status).toBe(404);
  await page.goto(`${BASE}/admin/content/offers?filter=expired`);
  await expect(page.getByTestId("offer-row").filter({ hasText: "معدّل" })).toBeVisible();
  // Package untouched (row identical, still on /packages).
  expect((await db.from("packages").select("title, status, price_minor, featured, updated_at").eq("id", pkgId).single()).data).toEqual(before);
  expect(await html("/packages")).toContain(PKG.title);
  await pub.close();
});

test("K4: hiding the package removes it from /packages but keeps the offers", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/content/packages`);
  await page.getByTestId("package-row").filter({ hasText: PKG.title }).getByRole("button", { name: "إخفاء" }).click();
  await expect.poll(async () => (await db.from("packages").select("status").eq("id", pkgId).single()).data?.status).toBe("hidden");
  await expect.poll(async () => (await html("/packages")).includes(PKG.title), { timeout: 15_000 }).toBe(false);
  expect(await html("/offers")).toContain(slugOf("sep27"));
});

test("K5: desktop + mobile nav: أعمالنا | البكجات | العروض | الخدمات | من نحن, each with its own page", async ({ browser }) => {
  const want = [
    ["أعمالنا", "/work"],
    ["البكجات", "/packages"],
    ["العروض", "/offers"],
    ["الخدمات", "/services"],
    ["من نحن", "/about"],
  ];
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desk.goto(`${BASE}/`);
  const items = await desk
    .locator("header nav[aria-label='القائمة الرئيسية']")
    .first()
    .locator("a")
    .evaluateAll((as) => as.map((a) => [a.textContent?.trim(), a.getAttribute("href")]));
  expect(items).toEqual(want);
  await desk.close();

  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(`${BASE}/`);
  await mob.getByRole("button", { name: "فتح القائمة" }).click();
  const dialog = mob.getByRole("dialog", { name: "القائمة" });
  const mItems = await dialog.locator("a[href^='/']").evaluateAll((as) => as.map((a) => [a.textContent?.trim(), a.getAttribute("href")]));
  for (const w of want) expect(mItems).toContainEqual(w);
  expect(mItems.findIndex((x) => x[1] === "/packages")).toBeLessThan(mItems.findIndex((x) => x[1] === "/offers"));
  await dialog.getByRole("link", { name: "البكجات" }).click();
  await expect(mob).toHaveURL(/\/packages$/);
  await expect(mob.getByRole("heading", { level: 1 })).toContainText("البكجات");
  await mob.close();
  for (const p of ["/packages", "/offers"]) expect((await fetch(`${BASE}${p}`)).status).toBe(200);
});

for (const who of ["staff", "a"] as const) {
  test(`K6: ${who} cannot open the packages admin`, async ({ browser }) => {
    const page = await newLoggedIn(browser, who, who === "staff" ? "/admin/content/packages" : "/portal");
    if (who !== "staff") await page.goto(`${BASE}/admin/content/packages/new`);
    await expect(page.getByTestId("forbidden")).toBeVisible();
    expect(await page.getByTestId("package-form").count()).toBe(0);
    await page.context().close();
  });
}
