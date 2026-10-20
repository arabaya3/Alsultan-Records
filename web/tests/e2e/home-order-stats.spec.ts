import { expect, test } from "@playwright/test";
import { BASE, db, newLoggedIn, skipSiteIntro } from "./qa-helpers";

/**
 * Owner requests 2026-10-20 (migration 0024):
 *  - home order after the hero: latest offers → 4 newest albums → counter → 3 videos → services → process;
 *  - the counter is OWNER-ENTERED in the admin (never invented) and the section never renders without a number;
 *  - owner-written descriptive texts accept 10,000 characters and the site shows them in full.
 * Restores everything it changes.
 *   BASE_URL=http://localhost:3600 npx playwright test home-order-stats
 */
test.describe.configure({ mode: "serial" });

// Section order from their stable heading ids (see HEADING_ID in app/(public)/page.tsx).
const ID_TO_KEY: Record<string, string> = { "offers-title": "offers", "albums-title": "albums", "stats-title": "stats", "work-title": "works", "services-title": "services", "steps-title": "process" };
const homeOrder = (page: import("@playwright/test").Page) =>
  page.locator("main section[aria-labelledby]").evaluateAll(
    (els, map) => els.map((e) => map[e.getAttribute("aria-labelledby") ?? ""]).filter(Boolean),
    ID_TO_KEY,
  );

test("HO1: home order — albums (4, newest first) before videos (3); no counter without a number", async ({ page }) => {
  await skipSiteIntro(page);
  await page.goto(`${BASE}/`);
  const order = (await homeOrder(page)).filter((k) => ["offers", "albums", "stats", "works"].includes(k!));
  // Offers render only when one is active; the counter only with a number.
  expect(order.filter((k) => k !== "offers" && k !== "stats")).toEqual(["albums", "works"]);
  expect(order).not.toContain("stats");
  const albums = page.locator("[data-home-section=albums] [data-album-card]");
  await expect(albums).toHaveCount(4);
  const shown = await albums.evaluateAll((as) => as.map((a) => a.getAttribute("data-album-card")));
  const dated = (await db.from("photo_albums").select("slug, event_date").eq("is_published", true)).data!;
  const newest = [...dated].sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? "")).map((a) => a.slug);
  expect(shown).toEqual(newest.filter((s) => shown.includes(s)).slice(0, 4)); // newest first
  expect(newest.slice(0, 4).sort()).toEqual([...shown].sort());
  await expect(page.locator("section[aria-labelledby=work-title] [data-work-card]")).toHaveCount(3);
});

test("HO2: owner enters the counter in the admin → it shows on the home page; clearing it hides the section", async ({ browser }) => {
  const admin = await newLoggedIn(browser, "owner", "/admin/content/nav");
  const form = admin.getByTestId("section-stats");
  try {
    await form.getByTestId("stat-value").fill("1250");
    await form.locator('input[name="is_visible"]').check();
    await form.getByRole("button", { name: "حفظ" }).click();
    await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");

    const pub = await admin.context().newPage();
    await skipSiteIntro(pub);
    await pub.goto(`${BASE}/`);
    const stats = pub.locator("[data-home-section=stats]");
    await expect(stats.locator("[data-stat-value]")).toHaveText("1,250");
    await expect(stats.getByRole("heading", { level: 2 })).toContainText("فرحة وثّقناها");
    const order = (await homeOrder(pub)).filter((k) => ["albums", "stats", "works"].includes(k!));
    expect(order).toEqual(["albums", "stats", "works"]);

    await form.getByTestId("stat-value").fill("");
    await form.getByRole("button", { name: "حفظ" }).click();
    // (the success message from the first save is still on screen — wait for the stored value instead)
    await expect.poll(async () => (await db.from("site_sections").select("stat_value").eq("key", "stats").single()).data!.stat_value).toBeNull();
    await pub.reload();
    await expect(pub.locator("[data-home-section=stats]")).toHaveCount(0); // visible but no number → not rendered
  } finally {
    await db.from("site_sections").update({ stat_value: null, is_visible: false }).eq("key", "stats");
    await admin.context().close();
  }
});

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
