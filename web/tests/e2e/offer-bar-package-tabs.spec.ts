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

test("offer bar: under the header on every public page, names the first offer and its end date, links to it and to the list", async ({ page }) => {
  await skipSiteIntro(page);
  for (const path of ["/", "/packages", "/work", "/about"]) {
    await page.goto(`${BASE}${path}`);
    await expect(bar(page), path).toBeVisible();
    // Directly after the site header, never inside it.
    expect(await page.evaluate(() => document.querySelector("header.site-header-flow")?.nextElementSibling?.hasAttribute("data-offer-bar")), path).toBe(true);
  }
  const first = bar(page).locator(`[data-offer-bar-link="${A.slug}"]`);
  await expect(first).toContainText(A.title);
  await expect(first.locator("[data-offer-bar-ends]")).toContainText("ينتهي");
  await expect(bar(page).locator("[data-offer-bar-all]")).toHaveAttribute("href", "/offers");
  await expect(bar(page).locator("[data-offer-bar-all]")).toContainText("٢");
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/offers/${A.slug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(A.title);
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
    for (const path of ["/", "/packages"]) {
      await page.goto(`${BASE}${path}`);
      await expect(bar(page)).toBeVisible();
      expect(await overflowPx(page), `${path}@${width}`).toBe(0);
    }
    for (const box of await page.locator("[data-offer-bar] a, [role=tab]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    await ctx.close();
  }
});

test("when the offers end, the bar and the card's offer line leave the site", async ({ page, browser }) => {
  expect((await db.from("offers").update({ ends_on: day(-1) }).like("slug", `${P}-%`)).error).toBeNull();
  await refreshPublicCache(browser);
  await skipSiteIntro(page);
  for (const path of ["/", "/packages"]) {
    await page.goto(`${BASE}${path}`);
    await expect(bar(page), path).toHaveCount(0);
  }
  await expect(page.locator("[data-package-offer]")).toHaveCount(0);
  expect((await fetch(new URL(`/offers/${A.slug}`, BASE), { redirect: "manual" })).status).toBe(404);
});
