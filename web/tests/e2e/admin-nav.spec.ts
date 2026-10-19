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

test("N1: admin sees the new groups; sub-pages moved to in-page tabs", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin");
  const nav = page.getByRole("navigation", { name: NAV });
  for (const g of ["اليوم", "الأعمال", "البيع", "صفحات الموقع", "الإعدادات"]) await expect(nav.getByText(g, { exact: true })).toBeVisible();
  // Collapsible group: its <summary> also holds the ▾ marker, so match the summary, not exact text.
  await expect(nav.getByTestId("nav-group-collapsible").locator("summary")).toContainText("شغل المناسبات");
  for (const l of ["الفيديوهات", "ألبومات الصور", "البكجات", "العروض والإعلانات", "الرئيسية", "الخدمات وطريقة الشغل", "الهوية ومعلومات النشاط", "القائمة والأقسام", "إعدادات اللوحة"])
    await expect(nav.getByRole("link", { name: l, exact: true })).toHaveCount(1);
  for (const gone of ["كل المحتوى", "تصنيفات الفيديو", "طريقة شغلنا", "الإعلانات", "النسخ الاحتياطي", "المستخدمون والصلاحيات"])
    await expect(nav.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  // Default modules: customers/events/calendar only.
  const ops = page.getByTestId("nav-group-collapsible");
  await ops.locator("summary").click();
  for (const l of ["العملاء", "المناسبات", "التقويم"]) await expect(nav.getByRole("link", { name: l, exact: true })).toBeVisible();
  for (const l of ["المالية", "طلبات الحجز", "العقود"]) await expect(nav.getByRole("link", { name: l, exact: true })).toHaveCount(0);

  // In-page tabs: both directions, aria-current on the active one.
  for (const [parent, child, childLabel] of [
    ["/admin/videos", "/admin/videos/categories", "التصنيفات"],
    ["/admin/content/services", "/admin/content/process", "طريقة شغلنا"],
    ["/admin/content/offers", "/admin/content/announcements", "الإعلانات"],
  ] as const) {
    await page.goto(`${BASE}${parent}`);
    const tabs = page.getByTestId("page-tabs");
    await expect(tabs.locator('[aria-current="page"]')).toHaveAttribute("href", parent);
    await tabs.getByRole("link", { name: childLabel, exact: true }).click();
    await page.waitForURL((u) => u.pathname === child);
    await expect(page.getByTestId("page-tabs").locator('[aria-current="page"]')).toHaveAttribute("href", child);
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
  await owner.goto(`${BASE}/admin/users`);
  await expect(owner.getByRole("navigation", { name: NAV }).getByRole("link", { name: "المستخدمون والصلاحيات" })).toBeVisible();
  await owner.context().close();

  const admin = await newLoggedIn(browser, "admin", "/admin/settings");
  await expect(admin.getByTestId("enabled-modules")).toHaveCount(0); // owner-only card
  await admin.getByTestId("nav-group-collapsible").locator("summary").click();
  await expect(admin.getByRole("link", { name: "المالية", exact: true })).toBeVisible();
  await admin.context().close();

  const staff = await newLoggedIn(browser, "staff", "/admin");
  const nav = staff.getByRole("navigation", { name: NAV });
  await staff.getByTestId("nav-group-collapsible").locator("summary").click();
  await expect(nav.getByRole("link", { name: "الوسائط", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "المناسبات", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "الإنتاج والتسليم", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "المالية", exact: true })).toHaveCount(0);
  await staff.context().close();
});
