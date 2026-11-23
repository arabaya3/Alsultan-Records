import { expect, test } from "@playwright/test";
import { BASE, db, newLoggedIn, skipSiteIntro } from "./qa-helpers";

/**
 * Owner requests 2026-10-20 (migration 0024):
 *  (the home order and the home counter of that request are gone: the home page is the fixed poster, see home-poster.spec)
 *  - owner-written descriptive texts accept 10,000 characters and the site shows them in full.
 * Restores everything it changes.
 *   BASE_URL=http://localhost:3600 npx playwright test home-order-stats
 */
test.describe.configure({ mode: "serial" });

test("HO3: a 10,000-character package description is saved from the admin and shown in full", async ({ browser }) => {
  const pkg = (await db.from("packages").select("id, slug, description").eq("status", "published").order("sort_order").limit(1).single()).data!;
  const long = `${"وصف طويل للبكج يشمل كل التفاصيل. ".repeat(400)}`.slice(0, 9990) + " نهاية.";
  expect(long.length).toBeGreaterThanOrEqual(9990);
  const admin = await newLoggedIn(browser, "owner", `/admin/content/packages/${pkg.id}`);
  try {
    const form = admin.getByTestId("package-form");
    await form.locator('textarea[name="description"]').fill(long);
    await form.getByRole("button", { name: /حفظ \(منشور\)|نشر/ }).click();
    await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
    expect((await db.from("packages").select("description").eq("id", pkg.id).single()).data!.description).toBe(long.trim());

    const pub = await admin.context().newPage();
    await skipSiteIntro(pub);
    await pub.goto(`${BASE}/packages`);
    const card = pub.locator(`[data-package-card="${pkg.slug}"]`);
    await expect(card).toContainText("نهاية."); // the end of the text is there: nothing was cut
    expect(await pub.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    // A long description is clamped on the card (the card stays card-sized) and expands in place.
    const more = card.getByRole("button", { name: "اقرأ المزيد" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect((await card.boundingBox())!.height).toBeLessThan(1000);
    await more.click();
    await expect(card.getByRole("button", { name: "عرض أقل" })).toHaveAttribute("aria-expanded", "true");
    expect((await card.boundingBox())!.height).toBeGreaterThan(1000);
  } finally {
    await db.from("packages").update({ description: pkg.description }).eq("id", pkg.id);
    await admin.context().close();
  }
});
