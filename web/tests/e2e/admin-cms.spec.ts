import { expect, test, type Page } from "@playwright/test";
import { anon, BASE, db, newLoggedIn } from "./qa-helpers";

/**
 * Owner content area («محتوى الموقع»). Runs against a PRODUCTION build (cache components + updateTag), e.g.
 *   BASE_URL=http://localhost:3600 npx playwright test admin-cms
 * Local Supabase with the CMS migrations (20261018000017+) and seed users. Every test cleans up its rows.
 */
test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const OFFER = { slug: `e2e-offer-${STAMP}`, title: `عرض اختبار ${STAMP}` };
const ANN_TEXT = `إعلان اختبار ${STAMP}`;
const YT_ID = "e2eCmsVid01"; // 11 chars, like a real YouTube id

let prevTagline: string | null = null;
let navBefore: { id: string; label: string } | null = null;
let navRetired: { id: string; label: string } | null = null;

const msg = (p: Page, testId: string) => p.getByTestId(testId).getByTestId("action-msg");
const yesterday = () => {
  const d = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron" }).format(new Date()));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
/** Public pages are cached for a day (offers until the next Hebron midnight); admin saves expire the tags at once. */
async function publicText(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.beforeAll(async () => {
  prevTagline = (await db.from("business_settings").select("tagline").eq("id", 1).single()).data?.tagline ?? null;
  navBefore = (await db.from("nav_items").select("id, label").eq("target", "packages").maybeSingle()).data ?? null;
  // Stored link to the removed services page (seeded by the CMS migration): kept in the table, retired in the UI.
  navRetired = (await db.from("nav_items").select("id, label").eq("target", "services").maybeSingle()).data ?? null;
  await db.from("showcase_videos").delete().eq("youtube_id", YT_ID);
});

test.afterAll(async () => {
  await db.from("business_settings").update({ tagline: prevTagline }).eq("id", 1);
  if (navBefore) await db.from("nav_items").update({ label: navBefore.label }).eq("id", navBefore.id);
  await db.from("announcements").delete().like("text", `%${STAMP}%`);
  await db.from("offers").delete().eq("slug", OFFER.slug);
  await db.from("showcase_videos").delete().eq("youtube_id", YT_ID);
});

test("C1: identity edit appears on the public site without a deploy", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/content/identity");
  const tagline = `شعار اختبار ${STAMP}`;
  const form = page.getByTestId("identity-form");
  await form.locator('input[name="tagline"]').fill(tagline);
  // https-only social links: http is refused with a clear message.
  await form.locator('input[name="facebook"]').fill("http://facebook.com/x");
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(msg(page, "identity-form")).toHaveAttribute("data-ok", "0");
  await form.locator('input[name="facebook"]').fill("");
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(msg(page, "identity-form")).toHaveAttribute("data-ok", "1");
  expect((await db.from("business_settings").select("tagline").eq("id", 1).single()).data?.tagline).toBe(tagline);
  await expect.poll(() => publicText(page, "/"), { timeout: 20_000 }).toContain(tagline);
  await page.context().close();
});

// C2 (service create -> reorder -> hide) was removed with the services screens; see C5b and admin-nav N1 for the
// new contract (old admin URLs redirect, the stored nav link is retired, the public pages redirect to /packages).

test("C3: offer create -> pin -> expire by date disappears from public", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/content/offers/new");
  const form = page.getByTestId("offer-form");
  await form.locator('input[name="title"]').fill(OFFER.title);
  await page.getByTestId("slug-hint").fill(OFFER.slug.replace(/-/g, " "));
  await form.locator('input[name="items"]').first().fill("ساعتان تصوير");
  await form.locator('input[name="price"]').fill("1500");
  await form.locator('input[name="show_price"]').check();
  await form.getByRole("button", { name: "معاينة" }).click();
  await page.waitForURL(/\/preview$/);
  await expect(page.getByTestId("offer-preview")).toContainText(OFFER.title);
  await page.getByRole("button", { name: "نشر" }).click();
  const row = async () => (await db.from("offers").select("id, status, pinned_home").eq("slug", OFFER.slug).single()).data!;
  await expect.poll(async () => (await row()).status).toBe("published");

  await page.goto(`${BASE}/admin/content/offers`);
  const r = page.getByTestId("offer-row").filter({ hasText: OFFER.title });
  await expect(r.getByTestId("offer-status")).toContainText("ساري");
  await r.getByRole("button", { name: "تثبيت", exact: true }).click();
  await expect.poll(async () => (await row()).pinned_home).toBe(true);
  await expect.poll(() => publicText(page, "/offers"), { timeout: 20_000 }).toContain(OFFER.title);

  // Expire through the secret-key fixture (no admin action -> no tag update): RLS hides it at once and the admin
  // lists it as ended. The cached public list is rebuilt at the next Hebron midnight (cache-life.ts, unit-tested in
  // cache-policy.test.ts) — a test cannot wait for midnight, so the rebuild is triggered the other documented way, an
  // admin save of the offers heading (unchanged), and the rebuilt list must no longer carry the ended offer.
  await db.from("offers").update({ starts_on: null, ends_on: yesterday() }).eq("slug", OFFER.slug);
  expect((await anon().from("offers").select("id").eq("slug", OFFER.slug)).data).toHaveLength(0);
  await page.goto(`${BASE}/admin/content/offers`);
  await expect(page.getByTestId("offer-row").filter({ hasText: OFFER.title }).getByTestId("offer-status")).toContainText("منتهي");
  expect(await publicText(page, "/offers")).toContain(OFFER.title); // still the cached list: nothing has refreshed it yet
  await page.goto(`${BASE}/admin/content/offers`);
  const heading = page.getByTestId("section-intro-offers");
  await heading.getByRole("button", { name: "حفظ" }).click();
  await expect(heading.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await expect.poll(() => publicText(page, "/offers"), { timeout: 20_000, intervals: [1_000] }).not.toContain(OFFER.title);
  expect((await page.request.get(`${BASE}/offers/${OFFER.slug}`)).status()).toBe(404);
  await page.context().close();
});

test("C4: announcement linked to an offer", async ({ browser }) => {
  test.setTimeout(300_000); // waits up to ~200 s for the public offers cache (see below)
  // Fresh active offer for the link (C3 left OFFER expired; a brand-new published offer avoids depending on
  // the previous offer's cached "expired" state).
  const c4Slug = `${OFFER.slug}-c4`;
  await db.from("offers").delete().eq("slug", c4Slug);
  expect((await db.from("offers").insert({ slug: c4Slug, title: "[E2E] عرض للإعلان", status: "published" })).error).toBeNull();
  const page = await newLoggedIn(browser, "admin", "/admin/content/announcements/new");
  const form = page.getByTestId("announcement-form");
  await form.locator('input[name="text"]').fill(ANN_TEXT);
  await form.locator('select[name="link_kind"]').selectOption("offer");
  const offerId = (await db.from("offers").select("id").eq("slug", c4Slug).single()).data!.id;
  await form.locator('select[name="link_offer_id"]').selectOption(offerId);
  await form.getByRole("button", { name: "نشر" }).click();
  await page.waitForURL(/\/admin\/content\/announcements\/[0-9a-f-]{36}/);
  const a = (await db.from("announcements").select("is_visible, link_kind, link_offer_id").eq("text", ANN_TEXT).single()).data!;
  expect(a).toMatchObject({ is_visible: true, link_kind: "offer", link_offer_id: offerId });
  await expect(page.getByTestId("announcement-preview")).toContainText(ANN_TEXT);
  await expect
    .poll(
      async () => {
        await page.goto(`${BASE}/`);
        return page.locator("[data-announcement-link]").filter({ hasText: ANN_TEXT }).getAttribute("href").catch(() => null);
      },
      // The offer was re-activated with the secret key above (bypassing admin updateTag), so the public offers
      // cache can keep it "expired" until cacheLife("minutes") lapses — same wait as C3.
      { timeout: 200_000, intervals: [5_000] },
    )
    .toBe(`/offers/${c4Slug}`);
  // Clean up THROUGH THE ADMIN so the public cache is invalidated. A direct DB delete left the announcement in
  // cached pages linking to a deleted offer; the link prefetch 404 then failed public.spec's console check.
  const annId = (await db.from("announcements").select("id").eq("text", ANN_TEXT).single()).data!.id;
  for (const [path, label] of [[`/admin/content/announcements/${annId}`, "حذف الإعلان"], [`/admin/content/offers/${offerId}`, "حذف العرض نهائياً"]]) {
    await page.goto(`${BASE}${path}`);
    await page.getByRole("button", { name: label }).click();
    await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
    await page.waitForURL((u) => !u.pathname.endsWith(path.split("/").pop()!));
  }
  expect((await db.from("announcements").select("id").eq("text", ANN_TEXT)).data).toHaveLength(0);
  expect((await db.from("offers").select("id").eq("slug", c4Slug)).data).toHaveLength(0);
  await expect.poll(async () => (await (await fetch(`${BASE}/`)).text()).includes(c4Slug), { timeout: 15_000 }).toBe(false);
  await page.context().close();
});

test("C5: renaming a nav item keeps its URL", async ({ browser }) => {
  test.skip(!navBefore, "no nav_items row for packages");
  const page = await newLoggedIn(browser, "admin", "/admin/content/nav");
  const label = `بكجاتنا ${STAMP.slice(-3)}`;
  const form = page.getByTestId("nav-packages");
  await form.locator('input[name="label"]').fill(label);
  await form.locator('input[name="is_visible"]').check();
  await form.getByRole("button", { name: "حفظ" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await expect
    .poll(
      async () => {
        await page.goto(`${BASE}/`);
        return page.getByRole("banner").getByRole("link", { name: label }).first().getAttribute("href").catch(() => null);
      },
      { timeout: 20_000 },
    )
    .toBe("/packages");
  await page.context().close();
});

test("C5b: the stored «الخدمات» nav link is retired: listed without a form, unchanged in the DB, absent from the public header", async ({ browser }) => {
  test.skip(!navRetired, "no nav_items row for services");
  const page = await newLoggedIn(browser, "admin", "/admin/content/nav");
  const row = page.getByTestId("nav-retired-services");
  await expect(row).toContainText(navRetired!.label);
  await expect(row).toContainText("أزيلت من الموقع");
  await expect(page.getByTestId("nav-services")).toHaveCount(0); // no editable-but-inert form
  await expect(row.locator("input, button")).toHaveCount(0);
  expect((await db.from("nav_items").select("label").eq("id", navRetired!.id).single()).data?.label).toBe(navRetired!.label);
  await page.goto(`${BASE}/`);
  const hrefs = await page.getByRole("banner").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs.filter((h) => h?.startsWith("/services"))).toEqual([]);
  await page.context().close();
});

test("C6: YouTube add + role promo + pin", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/videos");
  const form = page.getByTestId("video-create");
  await form.locator('input[name="youtube"]').fill(`https://youtu.be/${YT_ID}`);
  await form.locator('input[name="title"]').fill("برومو اختبار");
  await form.locator('input[name="role"][value="promo"]').check();
  await form.locator('input[name="sort_order"]').fill("999");
  await form.getByRole("button", { name: "إضافة" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  const row = async () => (await db.from("showcase_videos").select("role, pinned").eq("youtube_id", YT_ID).single()).data!;
  expect(await row()).toMatchObject({ role: "promo", pinned: false });
  await page.reload();
  await page.locator(`[data-testid=video-row][data-youtube-id="${YT_ID}"]`).getByTestId("video-more").locator("summary").click();
  await page.locator(`[data-testid=video-row][data-youtube-id="${YT_ID}"]`).getByRole("button", { name: "تثبيت" }).click();
  await expect.poll(async () => (await row()).pinned).toBe(true);
  expect((await anon().from("showcase_videos").select("role, pinned").eq("youtube_id", YT_ID).single()).data).toMatchObject({ role: "promo", pinned: true });
  // Clean up THROUGH THE ADMIN (it invalidates the public cache). A direct DB delete in afterAll left the
  // fake video in cached public pages for minutes; its YouTube thumbnail 404 then failed public.spec.
  await page.reload();
  await page.locator(`[data-testid=video-row][data-youtube-id="${YT_ID}"]`).getByTestId("video-more").locator("summary").click();
  await page.locator(`[data-testid=video-row][data-youtube-id="${YT_ID}"]`).getByRole("button", { name: "حذف" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "حذف" }).click();
  await expect.poll(async () => (await db.from("showcase_videos").select("id").eq("youtube_id", YT_ID)).data?.length).toBe(0);
  await expect.poll(async () => (await (await fetch(`${BASE}/`)).text()).includes(YT_ID), { timeout: 15_000 }).toBe(false);
  await page.context().close();
});

for (const who of ["staff", "a"] as const) {
  test(`C7: ${who} cannot open or use the content area`, async ({ browser }) => {
    // Customers are redirected away from /admin, so log them in to their own landing page first, then try.
    const page = await newLoggedIn(browser, who, who === "staff" ? "/admin/content/identity" : "/portal");
    if (who !== "staff") await page.goto(`${BASE}/admin/content/identity`);
    if (who === "staff") {
      await expect(page.getByTestId("forbidden")).toBeVisible();
      await expect(page.getByRole("link", { name: "الهوية ومعلومات النشاط" })).toHaveCount(0);
    } else {
      // Customers get the forbidden page (no admin sidebar, no form, no data).
      await expect(page.getByTestId("forbidden")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "أقسام لوحة الإدارة" })).toHaveCount(0);
    }
    expect(await page.getByTestId("identity-form").count()).toBe(0);
    await page.context().close();
  });
}
