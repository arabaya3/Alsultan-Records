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
  await form.locator('select[name="category"]').selectOption("dj");
  await form.locator('input[name="sort_order"]').fill("999");
  await form.getByRole("button", { name: "إضافة" }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  const row = () => db.from("showcase_videos").select("id, is_published, is_promo, title, source_url").eq("youtube_id", TEST_ID).single();
  const created = (await row()).data!;
  expect(created).toMatchObject({ is_published: true, is_promo: false, source_url: `https://www.youtube.com/watch?v=${TEST_ID}` });

  // anon sees it while published
  expect((await anon().from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(1);

  const tr = page.locator(`[data-testid=video-row][data-youtube-id="${TEST_ID}"]`);
  await page.reload();
  await tr.getByRole("button", { name: "إخفاء" }).click();
  await expect.poll(async () => (await row()).data!.is_published).toBe(false);
  expect((await anon().from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(0);

  await page.reload();
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

  await page.getByRole("button", { name: "حذف الفيديو" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await page.waitForURL((u) => u.pathname === "/admin/videos");
  expect((await db.from("showcase_videos").select("id").eq("youtube_id", TEST_ID)).data).toHaveLength(0);
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
});
