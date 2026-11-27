import { expect, test } from "@playwright/test";
import { BASE, db, newLoggedIn } from "./qa-helpers";

// Admin sidebar grouping + «الأقسام المفعّلة» (UX only: hidden modules stay reachable by URL).
const DEFAULTS = ["customers", "events", "calendar"];
const NAV = "أقسام لوحة الإدارة";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function setModules(mods: string[]) {
  const { error } = await db.from("app_settings").update({ enabled_modules: mods }).eq("id", 1);
  if (error) throw error;
}

test.beforeAll(() => setModules(DEFAULTS));
test.afterAll(() => setModules(DEFAULTS));

test("N1: admin sees four groups (home, site, customers & events, settings); sub-pages are in-page tabs", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin");
  const nav = page.getByRole("navigation", { name: NAV });
  for (const g of ["الرئيسية", "الموقع", "الزبائن والمناسبات"]) await expect(nav.getByText(g, { exact: true })).toBeVisible();
  // «الزبائن والمناسبات» is shown open like the other groups (owner design), no disclosure to click.
  await expect(nav.getByTestId("nav-group-collapsible")).toHaveCount(0);
  for (const l of ["نظرة عامة", "الصفحة الرئيسية", "الفيديوهات", "ألبومات الموقع", "البكجات", "العروض", "الإعلانات", "القائمة العلوية", "الإعدادات"])
    await expect(nav.getByRole("link", { name: l, exact: true })).toHaveCount(1);
  // Moved inside a page: process steps (from «الصفحة الرئيسية»), studio details, account, users, backups (settings tabs).
  for (const gone of ["الخدمات وطريقة الشغل", "كل المحتوى", "تصنيفات الفيديو", "طريقة شغلنا", "طريقة الشغل", "الهوية ومعلومات النشاط", "القائمة والأقسام", "إعدادات اللوحة", "حسابي وكلمة السر", "النسخ الاحتياطي", "المستخدمون والصلاحيات", "العروض والإعلانات", "ألبومات الصور"])
    await expect(nav.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  // Default modules: customers/events/calendar only.
  for (const l of ["العملاء", "المناسبات", "التقويم"]) await expect(nav.getByRole("link", { name: l, exact: true })).toBeVisible();
  for (const l of ["المالية", "طلبات الحجز", "العقود"]) await expect(nav.getByRole("link", { name: l, exact: true })).toHaveCount(0);

  // In-page tabs: both directions, aria-current on the active one.
  for (const [parent, child, childLabel] of [
    ["/admin/videos", "/admin/videos/categories", "التصنيفات"],
    ["/admin/content/offers", "/admin/content/announcements", "الإعلانات"],
  ] as const) {
    await page.goto(`${BASE}${parent}`);
    const tabs = page.getByTestId("page-tabs");
    await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute("href", parent);
    await tabs.getByRole("link", { name: childLabel, exact: true }).click();
    await page.waitForURL((u) => u.pathname === child);
    await expect(page.getByTestId("page-tabs").locator('[aria-current="page"]')).toHaveAttribute("href", child);
  }
  // The services admin screens were removed: old URLs land on the process page, which has no tabs any more.
  for (const old of ["/admin/content/services", "/admin/content/services/new"]) {
    await page.goto(`${BASE}${old}`);
    await expect(page).toHaveURL(/\/admin\/content\/process$/);
    await expect(page.getByRole("heading", { level: 1, name: "طريقة شغلنا" })).toBeVisible();
    await expect(page.getByTestId("page-tabs")).toHaveCount(0);
  }
  // Hidden module stays reachable by URL (no route blocking).
  const res = await page.goto(`${BASE}/admin/finance`);
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByTestId("forbidden")).toHaveCount(0);
  await page.context().close();
});

test("N2: owner enables finance; admin and staff menus follow the flags", async ({ browser }) => {
  const owner = await newLoggedIn(browser, "owner", "/admin/settings");
  const card = owner.getByTestId("enabled-modules");
  await expect(card).toBeVisible();
  await card.getByLabel("المالية").check();
  await card.getByLabel("الوسائط").check();
  await owner.getByRole("button", { name: "حفظ الأقسام" }).click();
  await expect(owner.getByText("حُفظت الأقسام المفعّلة")).toBeVisible();
  const { data } = await db.from("app_settings").select("enabled_modules").eq("id", 1).single();
  expect([...(data?.enabled_modules ?? [])].sort()).toEqual(["calendar", "customers", "events", "finance", "media"]);
  // Users & permissions is an owner-only settings tab now (not a sidebar entry).
  await owner.goto(`${BASE}/admin/users`);
  await expect(owner.getByTestId("page-tabs").getByRole("link", { name: "المستخدمون والصلاحيات" })).toHaveAttribute("aria-current", "page");
  await expect(owner.getByRole("navigation", { name: NAV }).getByRole("link", { name: "الإعدادات", exact: true })).toHaveAttribute("aria-current", "page");
  await owner.context().close();

  const admin = await newLoggedIn(browser, "admin", "/admin/settings");
  await expect(admin.getByTestId("enabled-modules")).toHaveCount(0); // owner-only card
  await expect(admin.getByRole("link", { name: "المالية", exact: true })).toBeVisible();
  await admin.context().close();

  const staff = await newLoggedIn(browser, "staff", "/admin");
  const nav = staff.getByRole("navigation", { name: NAV });
  await expect(nav.getByRole("link", { name: "الوسائط", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "المناسبات", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "الإنتاج والتسليم", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "المالية", exact: true })).toHaveCount(0);
  await staff.context().close();
});

test("N3: settings are one entry with role-filtered tabs; the studio details card is not repeated; home sections live on «الصفحة الرئيسية»", async ({ browser }) => {
  // Settings inner menu (admin redesign): grouped, «هوية النشاط» first.
  const TABS_ALL = ["هوية النشاط", "القائمة والأقسام", "حسابي", "المستخدمون والصلاحيات", "فيسبوك", "النسخ الاحتياطي"];
  const owner = await newLoggedIn(browser, "owner", "/admin/settings");
  await expect(owner.getByTestId("page-tabs").getByRole("link")).toHaveText(TABS_ALL);
  await expect(owner.getByTestId("settings-business-summary")).toHaveCount(0); // edited only in «هوية النشاط»
  for (const [href, label] of [["/admin/content/identity", "هوية النشاط"], ["/admin/account", "حسابي"], ["/admin/backups", "النسخ الاحتياطي"], ["/admin/settings/facebook", "فيسبوك"]] as const) {
    await owner.goto(`${BASE}${href}`);
    await expect(owner.getByTestId("page-tabs").getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(owner.getByRole("navigation", { name: NAV }).getByRole("link", { name: "الإعدادات", exact: true })).toHaveAttribute("aria-current", "page");
  }
  // The identity form still works from its tab.
  await owner.goto(`${BASE}/admin/content/identity`);
  await expect(owner.getByTestId("identity-form")).toBeVisible();
  await owner.context().close();

  const admin = await newLoggedIn(browser, "admin", "/admin/settings");
  await expect(admin.getByTestId("page-tabs").getByRole("link")).toHaveText(["هوية النشاط", "القائمة والأقسام", "حسابي"]);
  // Home: one editor with tabs — the hero, the sections list, each section's content, the booking steps; the nav page
  // keeps the header links only.
  await admin.goto(`${BASE}/admin/content/home`);
  await expect(admin.getByTestId("home-form")).toBeVisible();
  await expect(admin.getByTestId("home-tabs").getByRole("link")).toHaveText(["الواجهة", "الأقسام", "محتوى الأقسام", "خطوات الحجز"]);
  await admin.getByTestId("home-tabs").getByRole("link", { name: "الأقسام", exact: true }).click();
  await expect(admin.getByTestId("sections-order")).toBeVisible();
  await expect(admin.getByTestId("home-form")).toHaveCount(0); // one form per tab
  await admin.goto(`${BASE}/admin/content/home?tab=content&s=about`);
  await expect(admin.getByTestId("section-about")).toBeVisible();
  await admin.goto(`${BASE}/admin/content/home?tab=steps`);
  await expect(admin.getByTestId("steps-list").or(admin.getByText("لا توجد خطوات"))).toBeVisible();
  await admin.goto(`${BASE}/admin/content/nav`);
  await expect(admin.getByTestId("nav-list")).toBeVisible();
  await expect(admin.getByTestId("sections-order")).toHaveCount(0);
  await expect(admin.getByTestId("section-about")).toHaveCount(0);
  // Process page: «الصفحة الرئيسية» is current in the sidebar.
  await admin.goto(`${BASE}/admin/content/process`);
  await expect(admin.getByRole("navigation", { name: NAV }).getByRole("link", { name: "الصفحة الرئيسية", exact: true })).toHaveAttribute("aria-current", "page");
  await admin.context().close();

  // Staff: no settings page; their account is their only setting (no tabs, sidebar entry «حسابي وكلمة السر»).
  const staff = await newLoggedIn(browser, "staff", "/admin/account");
  await expect(staff.getByRole("navigation", { name: NAV }).getByRole("link", { name: "حسابي وكلمة السر", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(staff.getByRole("navigation", { name: NAV }).getByRole("link", { name: "الإعدادات", exact: true })).toHaveCount(0);
  await expect(staff.getByTestId("page-tabs")).toHaveCount(0);
  await staff.context().close();
});

test("N4: overview in the owner's design: open-site link, navy shortcuts with «تعديل الموقع» menu, three live numbers, follow-up and latest", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "نظرة عامة" })).toBeVisible();
  await expect(page.getByRole("link", { name: /فتح الموقع/ })).toHaveAttribute("href", "/");
  const qa = page.getByTestId("quick-actions");
  for (const [label, href] of [["أضف ألبوم", "/admin/albums"], ["أضف فيديو", "/admin/videos"], ["أضف عرض", "/admin/content/offers/new"]] as const)
    await expect(qa.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  const menu = page.getByTestId("edit-site-menu");
  await menu.locator("summary").click();
  await expect(menu.getByRole("link", { name: "تعديل الرئيسية" })).toHaveAttribute("href", "/admin/content/home");
  await expect(menu.getByRole("link", { name: "تعديل البكجات" })).toHaveAttribute("href", "/admin/content/packages");
  const stats = page.getByTestId("site-status").getByRole("link");
  await expect(stats).toHaveCount(3);
  await expect(stats.nth(0)).toContainText("عروض فعّالة");
  await expect(stats.nth(1)).toContainText("ألبومات منشورة");
  await expect(stats.nth(2)).toContainText("فيديو منشور");
  await expect(page.getByRole("heading", { level: 2, name: "يحتاج متابعة" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "آخر ما نُشر" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.context().close();
});
