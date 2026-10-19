import { expect, test } from "@playwright/test";
import { anon, as, db, newLoggedIn } from "./qa-helpers";

/**
 * Admin showcase videos (local stack, seed users, after `node scripts/import-content.mjs --target local --apply`
 * or on an empty table). Run: BASE_URL=http://localhost:3400 npx playwright test admin-videos
 * Uses a fixed test ID and restores the previous promo afterwards.
 */
test.describe.configure({ mode: "serial" });

const TEST_ID = "e2eTestVid1";
let prevPromo: string | null = null;

test.beforeAll(async () => {
  await db.from("showcase_videos").delete().eq("youtube_id", TEST_ID);
  prevPromo = (await db.from("showcase_videos").select("id").eq("is_promo", true).maybeSingle()).data?.id ?? null;
});

test.afterAll(async () => {
  await db.from("showcase_videos").delete().eq("youtube_id", TEST_ID);
  if (prevPromo) {
    await db.from("showcase_videos").update({ is_promo: false }).eq("is_promo", true);
    await db.from("showcase_videos").update({ is_promo: true }).eq("id", prevPromo);
  }
});

test("V1: nav entry is visible to admin and the page lists videos", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/videos");
  await expect(page.getByRole("heading", { level: 1, name: "الفيديوهات" })).toBeVisible();
  await expect(page.getByRole("link", { name: "الفيديوهات" }).first()).toBeVisible();
  await page.context().close();
});

test("V2: rejects HTML/iframe and non-YouTube input, stores nothing", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/videos");
  const form = page.getByTestId("video-create");
  for (const bad of [`<iframe src="https://www.youtube.com/embed/${TEST_ID}"></iframe>`, `https://evil.example/watch?v=${TEST_ID}`]) {
    await form.locator('input[name="youtube"]').fill(bad);
    await form.locator('input[name="title"]').fill("فيديو اختبار");
    await form.getByRole("button", { name: "إضافة" }).click();
    await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "0");
    await expect(form.getByRole("alert")).toContainText("يوتيوب");
  }
  expect((await db.from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(0);
  await page.context().close();
});

test("V3: create from URL, toggle publish, make promo, edit, delete", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/videos");
  const form = page.getByTestId("video-create");
  await form.locator('input[name="youtube"]').fill(`https://youtu.be/${TEST_ID}`);
  await form.locator('input[name="title"]').fill("فيديو اختبار");
  const cat = (await db.from("video_categories").select("id").order("sort_order").limit(2)).data ?? [];
  for (const c of cat) await form.locator(`input[name="category_ids"][value="${c.id}"]`).check();
  if (cat[1]) await form.locator(`input[name="primary_category"][value="${cat[1].id}"]`).check();
  await form.locator('input[name="sort_order"]').fill("999");
  await form.getByRole("button", { name: "إضافة" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  const row = () => db.from("showcase_videos").select("id, is_published, is_promo, title, source_url").eq("youtube_id", TEST_ID).single();
  const created = (await row()).data!;
  expect(created).toMatchObject({ is_published: true, is_promo: false, source_url: `https://www.youtube.com/watch?v=${TEST_ID}` });
  const links = (await db.from("showcase_video_categories").select("category_id, is_primary").eq("video_id", created.id)).data ?? [];
  expect(links).toHaveLength(cat.length);
  if (cat[1]) expect(links.find((l) => l.is_primary)?.category_id).toBe(cat[1].id);

  // anon sees it while published
  expect((await anon().from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(1);

  const tr = page.locator(`[data-testid=video-row][data-youtube-id="${TEST_ID}"]`);
  await page.reload();
  await tr.getByRole("button", { name: "إخفاء" }).click();
  await expect.poll(async () => (await row()).data!.is_published).toBe(false);
  expect((await anon().from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(0);

  await page.reload();
  await tr.getByTestId("video-more").locator("summary").click();
  await tr.getByRole("button", { name: "اجعله تعريفياً" }).click();
  await expect.poll(async () => (await row()).data!.is_promo).toBe(true);
  const promos = (await db.from("showcase_videos").select("id").eq("is_promo", true)).data!;
  expect(promos).toHaveLength(1);

  await page.goto(`/admin/videos/${created.id}`);
  const edit = page.getByTestId("video-edit");
  await edit.locator('input[name="title"]').fill("فيديو اختبار معدّل");
  await edit.getByRole("button", { name: "حفظ" }).click();
  await expect(edit.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  expect((await row()).data!.title).toBe("فيديو اختبار معدّل");
  expect((await db.from("showcase_videos").select("title_source").eq("id", created.id).single()).data!.title_source).toBe("manual");

  // needs_review: set, filter, clear (clearing stamps reviewed_at)
  await edit.locator('input[name="needs_review"]').check();
  await edit.locator('textarea[name="review_note"]').fill("تحقق من التصنيف");
  await edit.getByRole("button", { name: "حفظ" }).click();
  await expect(edit.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await page.goto("/admin/videos?filter=review");
  await expect(page.locator(`[data-testid=video-row][data-youtube-id="${TEST_ID}"]`)).toBeVisible();
  await page.locator(`[data-testid=video-row][data-youtube-id="${TEST_ID}"]`).getByRole("button", { name: "تمت المراجعة" }).click();
  await expect
    .poll(async () => (await db.from("showcase_videos").select("needs_review, reviewed_at").eq("id", created.id).single()).data)
    .toMatchObject({ needs_review: false });
  expect((await db.from("showcase_videos").select("reviewed_at").eq("id", created.id).single()).data!.reviewed_at).not.toBeNull();

  // restore YouTube title
  await db.from("showcase_videos").update({ youtube_title: "عنوان يوتيوب الأصلي | العريس" }).eq("id", created.id);
  await page.goto(`/admin/videos/${created.id}`);
  await page.getByTestId("restore-title").getByRole("button", { name: "استعادة عنوان YouTube" }).click();
  await expect.poll(async () => (await db.from("showcase_videos").select("title, title_source").eq("id", created.id).single()).data).toMatchObject({
    title: "عنوان يوتيوب الأصلي | العريس",
    title_source: "youtube",
  });

  await page.getByRole("button", { name: "حذف الفيديو" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await page.waitForURL((u) => u.pathname === "/admin/videos");
  expect((await db.from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(0);
  await page.context().close();
});

test("V5: categories page — create, reorder, hide, delete", async ({ browser }) => {
  await db.from("video_categories").delete().eq("slug", "e2e_cat");
  const page = await newLoggedIn(browser, "admin", "/admin/videos/categories");
  await expect(page.getByRole("heading", { level: 1, name: "تصنيفات الفيديو" })).toBeVisible();
  const form = page.getByTestId("category-create");
  await form.locator('input[name="title"]').fill("تصنيف اختبار");
  await form.locator('input[name="slug"]').fill("e2e_cat");
  await form.locator('input[name="sort_order"]').fill("99999");
  await form.getByRole("button", { name: "إضافة" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  const get = async () => (await db.from("video_categories").select("id, sort_order, is_published").eq("slug", "e2e_cat").single()).data!;
  expect((await anon().from("video_categories").select("slug").eq("slug", "e2e_cat")).data).toHaveLength(1);

  await page.reload();
  const row = page.locator('[data-testid=category-row][data-slug="e2e_cat"]');
  const before = (await get()).sort_order;
  await row.getByRole("button", { name: "↑ أعلى" }).click();
  await expect.poll(async () => (await get()).sort_order).not.toBe(before);
  await page.reload();
  await row.getByRole("button", { name: "إخفاء" }).click();
  await expect.poll(async () => (await get()).is_published).toBe(false);
  expect((await anon().from("video_categories").select("slug").eq("slug", "e2e_cat")).data).toHaveLength(0);

  await page.reload();
  await row.getByRole("button", { name: "حذف" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await db.from("video_categories").select("id").eq("slug", "e2e_cat")).data).toHaveLength(0);
  await page.context().close();
});

test("V4: staff and customers are denied (UI + API)", async ({ browser }) => {
  const staff = await newLoggedIn(browser, "staff", "/admin");
  await staff.goto("/admin/videos");
  await expect(staff.getByTestId("forbidden")).toBeVisible();
  await expect(staff.getByRole("link", { name: "الفيديوهات" })).toHaveCount(0);
  await staff.context().close();

  for (const who of ["staff", "a"] as const) {
    const c = await as(who);
    const { error } = await c
      .from("showcase_videos")
      .insert({ youtube_id: TEST_ID, source_url: `https://youtu.be/${TEST_ID}`, title: "ممنوع", category: "other" });
    expect(error).not.toBeNull();
  }
  // anon never sees admin-only columns
  expect((await anon().from("showcase_videos").select("verification_notes")).error).not.toBeNull();
  expect((await anon().from("showcase_videos").select("needs_review")).error).not.toBeNull();
  expect((await anon().from("showcase_videos").select("review_note")).error).not.toBeNull();
});
