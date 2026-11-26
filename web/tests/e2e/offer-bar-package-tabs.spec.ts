import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { BASE, db, overflowPx, refreshPublicCache, skipSiteIntro } from "./qa-helpers";

/**
 * Offer bar (time-limited offers under the header, gone when they end) and the packages page as tabs (one group at a
 * time, deep links open the right tab, an active offer is named on its package's card).
 *   BASE_URL=http://localhost:3600 npx playwright test offer-bar-package-tabs --project=chromium --project=mobile
 * Fixtures via the SECRET key, then refreshPublicCache (the owner's next admin save does the same); removed afterwards.
 * Relies on the seeded packages (scripts/seed-packages.mjs): four groups, «men-hall» in the second.
 */
test.describe.configure({ mode: "serial", timeout: 300_000 });

const day = (offset: number) => {
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(`${t}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const P = "e2e-bar";
const PKG = "men-hall";
const A = { slug: `${P}-first`, title: "عرض الشريط الأول", status: "published", currency: "ILS", starts_on: day(-1), ends_on: day(7), pinned_home: true, sort_order: 1 };
const B = { slug: `${P}-second`, title: "عرض الشريط الثاني", status: "published", currency: "ILS", starts_on: null, ends_on: day(20), pinned_home: false, sort_order: 2 };
let groups: string[] = [];

const bar = (p: Page) => p.locator("[data-offer-bar]");
const headerOffers = (p: Page) => p.locator("header nav[aria-label='القائمة الرئيسية'] a[href='/offers']");
async function mobileMenuHrefs(p: Page) {
  await p.getByRole("button", { name: "فتح القائمة" }).click();
  const hrefs = await p.getByRole("dialog", { name: "القائمة" }).locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  await p.keyboard.press("Escape");
  return hrefs;
}

test.beforeAll(async ({ browser }) => {
  await db.from("offers").delete().like("slug", `${P}-%`);
  const pkg = (await db.from("packages").select("id").eq("slug", PKG).single()).data;
  expect(pkg, `seeded package ${PKG}`).toBeTruthy();
  const { error } = await db.from("offers").insert([{ ...A, package_id: pkg!.id }, B]);
  expect(error).toBeNull();
  // Groups in owner order (first package of each group), as the page builds them.
  const rows = (await db.from("packages").select("group_label, sort_order").eq("status", "published").order("sort_order")).data ?? [];
  groups = [...new Set(rows.map((r) => r.group_label ?? "بكجات أخرى"))];
  await refreshPublicCache(browser);
});

test.afterAll(async ({ browser }) => {
  await db.from("offers").delete().like("slug", `${P}-%`);
  await refreshPublicCache(browser); // later specs must not see the bar
});

test("offer bar: under the header on the public pages (the home page shows the carousel instead), names the first offer and its end date, links to it", async ({ page }) => {
  await skipSiteIntro(page);
  for (const path of ["/packages", "/work", "/about"]) {
    await page.goto(`${BASE}${path}`);
    await expect(bar(page), path).toBeVisible();
    // Directly after the site header, never inside it.
    expect(await page.evaluate(() => document.querySelector("header.site-header-flow")?.nextElementSibling?.hasAttribute("data-offer-bar")), path).toBe(true);
  }
  const first = bar(page).locator(`[data-offer-bar-link="${A.slug}"]`);
  await expect(first).toContainText(A.title);
  await expect(first.locator("[data-offer-bar-ends]")).toContainText("ينتهي");
  await expect(bar(page).locator("a[href='/offers']")).toHaveCount(0); // no «كل العروض» link in the bar (owner request); the header link lists them
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/offers/${A.slug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(A.title);
});

test("home: active offers as a carousel under the hero (no top bar there): name, link, arrows and dots switch offers", async ({ page }) => {
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`);
  await expect(bar(page)).toHaveCount(0);
  const c = page.locator("[data-offer-carousel]");
  await expect(c).toBeVisible();
  // Right after the hero, before the first section.
  expect(
    await c.evaluate((el) => {
      const hero = document.querySelector("[data-home-hero]");
      return !!hero && (hero.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
    }),
  ).toBe(true);
  await expect(c).toContainText("عرض لفترة محدودة");
  await expect(c.locator(`[data-offer-slide="${A.slug}"]`)).toContainText(A.title);
  await expect(c.locator(`[data-offer-carousel-link="${A.slug}"]`)).toHaveAttribute("href", `/offers/${A.slug}`);
  await expect(c.getByRole("button", { name: /^العرض [١٢]$/ })).toHaveCount(2);
  await c.getByRole("button", { name: "العرض التالي" }).click();
  await expect(c.locator(`[data-offer-slide="${B.slug}"]`)).toContainText(B.title);
  await c.getByRole("button", { name: "العرض ١" }).click();
  await expect(c.locator(`[data-offer-slide="${A.slug}"]`)).toBeVisible();
  await c.locator(`[data-offer-carousel-link="${A.slug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/offers/${A.slug}$`));
});

test("header «العروض» link is shown while an offer is active (desktop and mobile menu)", async ({ page, browser }) => {
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`);
  await expect(headerOffers(page).first()).toBeVisible(); // desktop nav (the mobile menu holds its own copy)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await ctx.newPage();
  await skipSiteIntro(m);
  await m.goto(`${BASE}/`);
  expect(await mobileMenuHrefs(m)).toContain("/offers");
  await ctx.close();
});

test("packages: one tab per group, the first open; clicking and the keyboard switch groups; panels not shown are hidden", async ({ page }) => {
  await page.goto(`${BASE}/packages`);
  const tabs = page.getByRole("tablist", { name: "أنواع البكجات" }).getByRole("tab");
  await expect(tabs).toHaveCount(groups.length);
  expect(await tabs.evaluateAll((ts) => ts.map((t) => t.getAttribute("data-package-tab")))).toEqual(groups);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1); // hidden panels are not exposed
  const visibleCards = () => page.locator("[data-package-panel]:not([hidden]) [data-package-card]");
  expect(await visibleCards().count()).toBeGreaterThan(0);

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(`[data-package-panel]:not([hidden]) [data-package-card="${PKG}"]`)).toBeVisible();

  // RTL: ArrowLeft moves to the next tab (reading order), ArrowRight back; Home/End jump; focus follows.
  await tabs.nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.nth(groups.length - 1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  // Only the selected tab is in the Tab order.
  expect(await tabs.evaluateAll((ts) => ts.filter((t) => t.getAttribute("tabindex") === "0").length)).toBe(1);
});

test("a link to /packages#<slug> opens the tab that holds the package and shows it; the card names its active offer", async ({ page }) => {
  await page.goto(`${BASE}/packages#${PKG}`);
  const card = page.locator(`[data-package-card="${PKG}"]`);
  await expect(card).toBeVisible();
  await expect(card).toBeInViewport();
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true"); // «${PKG}» is in the second group
  const offer = card.locator("[data-package-offer]");
  await expect(offer).toContainText("عليه عرض");
  await expect(offer).toContainText(A.title);
  await expect(offer).toHaveAttribute("href", `/offers/${A.slug}`);
  // Only the linked package carries it.
  await expect(page.locator("[data-package-offer]")).toHaveCount(1);
  // The offer page's link back to the package lands on the same card.
  await page.goto(`${BASE}/offers/${A.slug}`);
  await page.locator(`a[href="/packages#${PKG}"]`).first().click();
  await expect(page.locator(`[data-package-card="${PKG}"]`)).toBeVisible();
});

test("axe: /packages (tabs + offer bar) has no serious/critical violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE}/packages`);
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
});

test("@mobile offer bar and tabs fit from 360 px: no horizontal page scroll, targets at least 44 px", async ({ browser }) => {
  for (const width of [360, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    await skipSiteIntro(page);
    // Home: the carousel (no bar there); its link, arrows and dots are full-size touch targets.
    await page.goto(`${BASE}/`);
    await expect(page.locator("[data-offer-carousel]")).toBeVisible();
    expect(await overflowPx(page), `/@${width}`).toBe(0);
    const homeTargets = page.locator("[data-offer-carousel] a, [data-offer-carousel] button:visible");
    for (const box of await homeTargets.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ h: r.height, w: r.width })))) {
      expect(box.h).toBeGreaterThanOrEqual(44);
      expect(box.w).toBeGreaterThanOrEqual(44);
    }
    await page.goto(`${BASE}/packages`);
    await expect(bar(page)).toBeVisible();
    expect(await overflowPx(page), `/packages@${width}`).toBe(0);
    for (const box of await page.locator("[data-offer-bar] a, [role=tab]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await ctx.close();
  }
});

test("home strip with one active offer: no arrows, dots, progress or motion; the offer stays put", async ({ page, browser }) => {
  expect((await db.from("offers").update({ ends_on: day(-1) }).eq("slug", B.slug)).error).toBeNull();
  try {
    await refreshPublicCache(browser);
    await skipSiteIntro(page);
    await page.goto(`${BASE}/`);
    const c = page.locator("[data-offer-carousel]");
    await expect(c.locator(`[data-offer-slide="${A.slug}"]`)).toBeVisible();
    await expect(c.getByRole("button")).toHaveCount(0);
    await expect(c.locator("[data-offer-progress]")).toHaveCount(0);
    await page.waitForTimeout(7_000);
    await expect(c.locator(`[data-offer-slide="${A.slug}"]`)).toBeVisible();
  } finally {
    await db.from("offers").update({ ends_on: B.ends_on }).eq("slug", B.slug);
    await refreshPublicCache(browser);
  }
});

test("home strip: a touch swipe changes the offer; hovering pauses the timer", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`);
  const c = page.locator("[data-offer-carousel]");
  await expect(c.locator(`[data-offer-slide="${A.slug}"]`)).toBeVisible();
  const box = (await c.boundingBox())!;
  const y = box.y + box.height / 2;
  // Swipe to the right (RTL: next).
  await c.dispatchEvent("pointerdown", { pointerType: "touch", clientX: box.x + 60, clientY: y, isPrimary: true });
  await c.dispatchEvent("pointerup", { pointerType: "touch", clientX: box.x + 200, clientY: y, isPrimary: true });
  await expect(c.locator(`[data-offer-slide="${B.slug}"]`)).toBeVisible();
  await ctx.close();

  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await skipSiteIntro(desk);
  await desk.goto(`${BASE}/`);
  const d = desk.locator("[data-offer-carousel]");
  await d.hover();
  await desk.waitForTimeout(7_500);
  await expect(d.locator(`[data-offer-slide="${A.slug}"]`)).toBeVisible(); // paused: still the first offer
  await desk.mouse.move(5, 5);
  await expect(d.locator(`[data-offer-slide="${B.slug}"]`)).toBeVisible({ timeout: 9_000 }); // resumes
  await desk.close();
});

test("when the offers end, the bar, the card's offer line and the header «العروض» link leave the site", async ({ page, browser }) => {
  expect((await db.from("offers").update({ ends_on: day(-1) }).like("slug", `${P}-%`)).error).toBeNull();
  await refreshPublicCache(browser);
  await skipSiteIntro(page);
  for (const path of ["/", "/packages"]) {
    await page.goto(`${BASE}${path}`);
    await expect(bar(page), path).toHaveCount(0);
    await expect(page.locator("[data-offer-carousel]"), path).toHaveCount(0);
  }
  await expect(page.locator("[data-package-offer]")).toHaveCount(0);
  expect((await fetch(new URL(`/offers/${A.slug}`, BASE), { redirect: "manual" })).status).toBe(404);
  // No active offer: the header link would lead to an empty page, so it is not shown (the saved menu row is never written).
  await page.goto(`${BASE}/`);
  await expect(headerOffers(page)).toHaveCount(0);
  await expect(page.locator("header nav[aria-label='القائمة الرئيسية'] a[href='/packages']").first()).toBeVisible();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await ctx.newPage();
  await skipSiteIntro(m);
  await m.goto(`${BASE}/`);
  expect(await mobileMenuHrefs(m)).not.toContain("/offers");
  await ctx.close();
  // The page itself still answers (old links), with its empty state.
  expect((await fetch(new URL("/offers", BASE))).status).toBe(200);
});
