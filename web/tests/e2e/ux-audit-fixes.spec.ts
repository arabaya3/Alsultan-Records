import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { BASE, EV, newLoggedIn } from "./qa-helpers";

/**
 * Regressions for docs/frontend-ux-audit.md (UX1–UX4). Local isolated stack + production build, seed data only.
 *   BASE_URL=http://localhost:3401 npx playwright test tests/e2e/ux-audit-fixes.spec.ts --project=chromium
 */
const overflow = (p: import("@playwright/test").Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [360, 390]) {
  test(`UX1 admin finance has no page-level horizontal scroll at ${width}px; the table scrolls in its own box`, async ({ browser }) => {
    const page = await newLoggedIn(browser, "owner", "/admin/finance", width);
    await page.goto(`${BASE}/admin/finance`, { waitUntil: "networkidle" });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const box = page.locator("table").first().locator("xpath=..");
    expect(await box.evaluate((e) => getComputedStyle(e).overflowX)).toBe("auto");
    await page.context().close();
  });

  test(`UX1 portal films list has no horizontal scroll at ${width}px`, async ({ browser }) => {
    const page = await newLoggedIn(browser, "a", `/portal/events/${EV.A1}/videos`, width);
    await page.goto(`${BASE}/portal/events/${EV.A1}/videos`, { waitUntil: "networkidle" });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const card = page.getByTestId("video-deliverable").first();
    const b = await card.boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= width).toBeTruthy();
    await page.context().close();
  });
}

test("UX2 portal payment history names the method in Arabic (no raw bank_transfer)", async ({ browser }) => {
  const page = await newLoggedIn(browser, "a", `/portal/events/${EV.A1}/payments`, 390);
  await page.goto(`${BASE}/portal/events/${EV.A1}/payments`, { waitUntil: "networkidle" });
  const main = page.locator("main");
  await expect(main).not.toContainText("bank_transfer");
  await expect(main).toContainText("تحويل بنكي");
  await page.context().close();
});

test("UX3 admin calendar day links: accessible name contains the visible text (axe label-content-name-mismatch)", async ({ browser }) => {
  const page = await newLoggedIn(browser, "owner", "/admin/calendar", 1440);
  await page.goto(`${BASE}/admin/calendar`, { waitUntil: "networkidle" });
  const day = page.getByTestId("calendar-day").first();
  await expect(day).toHaveAccessibleName(/^1 /);
  const r = await new AxeBuilder({ page }).withRules(["label-content-name-mismatch"]).analyze();
  expect(r.violations).toEqual([]);
  await page.context().close();
});

test("UX4 native checkboxes and radios are at least 20px (WCAG 2.5.8 target size)", async ({ browser }) => {
  const page = await newLoggedIn(browser, "owner", "/admin/settings", 390);
  await page.goto(`${BASE}/admin/settings`, { waitUntil: "networkidle" });
  const sizes = await page.locator("input[type=checkbox]:visible").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(sizes.length).toBeGreaterThan(0);
  for (const h of sizes) expect(h).toBeGreaterThanOrEqual(20);
  await page.context().close();
});
