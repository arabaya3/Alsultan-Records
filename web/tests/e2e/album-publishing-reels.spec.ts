import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { BASE, db, newLoggedIn, skipSiteIntro } from "./qa-helpers";

/**
 * Owner request 2026-10-28 (feature/album-publishing-reels, migrations 0026–0027):
 *  AP1 an occasion from a year ago published today is FIRST (albums page + home); a draft never shows
 *  AP2 editing an old album does not move it
 *  AP3 hero source «newest album» follows publish / hide; back to manual restores the owner's photo
 *  RL1 promos as vertical reels: lazy, one player, keyboard, Esc, deep link, Back
 *  FB1 Facebook page link is owner-only and honestly «غير مربوط»
 * YouTube is blocked in these tests (no network dependency; also exercises the failed-thumbnail path).
 * Restores everything it changes.
 */
test.describe.configure({ mode: "serial" });

const SLUG = `e2e-pub-${Date.now().toString(36)}`;
let albumId = "";
let photoId = "";
let featuredBefore: string[] | null = null;
let heroBefore: {
  hero_cover_source: string;
  hero_cover_photo_id: string | null;
} | null = null;

const yearAgo = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};
const blockYouTube = (page: Page) =>
  page.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.abort());

test.beforeAll(async () => {
  // A real, processed photo to reuse (same stored variants), so the album renders like any other.
  const src = (
    await db
      .from("album_photos")
      .select("variants, width, height, mime, bytes")
      .eq("upload_status", "ready")
      .not("variants", "is", null)
      .limit(1)
      .single()
  ).data!;
  const a = await db
    .from("photo_albums")
    .insert({
      slug: SLUG,
      title: "مناسبة السنة الماضية (اختبار)",
      event_date: yearAgo(),
      is_published: false,
    })
    .select("id")
    .single();
  albumId = a.data!.id;
  photoId = randomUUID();
  const p = await db
    .from("album_photos")
    .insert({
      id: photoId,
      album_id: albumId,
      storage_path_original: `albums/${albumId}/${photoId}/original.jpg`,
      mime: src.mime,
      bytes: src.bytes,
      width: src.width,
      height: src.height,
      variants: src.variants,
      upload_status: "ready",
      is_published: true,
      sort_order: 10,
    })
    .select("id")
    .single();
  expect(p.error).toBeNull();
  const sec = (
    await db
      .from("site_sections")
      .select("featured_ids")
      .eq("key", "albums")
      .single()
  ).data!;
  const featured: string[] = sec.featured_ids ?? [];
  featuredBefore = featured;
  if (featured.length)
    await db
      .from("site_sections")
      .update({ featured_ids: [] })
      .eq("key", "albums");
  heroBefore = (
    await db
      .from("business_settings")
      .select("hero_cover_source, hero_cover_photo_id")
      .eq("id", 1)
      .single()
  ).data!;
});

test.afterAll(async ({ browser }) => {
  // Hide the test album through the admin first: that action expires the public albums cache, so no later page
  // (or later spec) is served a cached card pointing at the rows deleted below.
  if (albumId) {
    const st = (await db.from("photo_albums").select("is_published").eq("id", albumId).maybeSingle()).data;
    if (st?.is_published) {
      const admin = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
      await admin.getByTestId("album-unpublish").getByRole("button", { name: "إخفاء الألبوم" }).click();
      await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
      await expect(admin.getByTestId("album-publish")).toBeVisible();
      await admin.close();
    }
  }
  if (featuredBefore?.length)
    await db
      .from("site_sections")
      .update({ featured_ids: featuredBefore })
      .eq("key", "albums");
  if (heroBefore)
    await db.from("business_settings").update(heroBefore).eq("id", 1);
  if (albumId) {
    await db
      .from("photo_albums")
      .update({ cover_photo_id: null })
      .eq("id", albumId);
    await db.from("album_photos").delete().eq("album_id", albumId);
    await db.from("photo_albums").delete().eq("id", albumId);
  }
});

async function firstAlbumOnPhotos(page: Page) {
  await page.goto(`${BASE}/work?tab=photos`);
  return page
    .locator("[data-album-grid] [data-album-card]")
    .first()
    .getAttribute("data-album-card");
}

test("AP1: a year-old occasion published today comes first; the draft never showed", async ({
  browser,
  page,
}) => {
  await skipSiteIntro(page);
  expect(await firstAlbumOnPhotos(page)).not.toBe(SLUG); // draft: not public
  await expect(page.locator(`[data-album-card="${SLUG}"]`)).toHaveCount(0);

  const admin = await newLoggedIn(browser, "owner", `/admin/albums/${albumId}`);
  await admin
    .getByTestId("album-publish")
    .getByRole("button", { name: "نشر الألبوم" })
    .click();
  await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect(admin.getByTestId("album-unpublish")).toBeVisible();
  const row = (
    await db
      .from("photo_albums")
      .select("published_at, event_date")
      .eq("id", albumId)
      .single()
  ).data!;
  expect(Date.now() - Date.parse(row.published_at)).toBeLessThan(5 * 60_000); // stamped by the DB now
  expect(row.event_date).toBe(yearAgo()); // occasion date untouched
  await admin.close();

  expect(await firstAlbumOnPhotos(page)).toBe(SLUG);
  await page.goto(`${BASE}/`);
  await expect(
    page.locator("[data-home-section=albums] [data-album-card]").first(),
  ).toHaveAttribute("data-album-card", SLUG);
});

test("AP2: renaming an older album does not move it above the newest", async ({
  browser,
  page,
}) => {
  await skipSiteIntro(page);
  const older = (
    await db
      .from("photo_albums")
      .select("id, slug, title, published_at")
      .eq("is_published", true)
      .is("deleted_at", null)
      .neq("id", albumId)
      .order("listed_at", { ascending: false })
      .limit(1)
      .single()
  ).data!;
  const admin = await newLoggedIn(
    browser,
    "owner",
    `/admin/albums/${older.id}`,
  );
  try {
    const edit = admin.getByTestId("album-edit");
    await edit.locator("input[name=title]").fill(`${older.title} ✓`);
    await edit.getByRole("button", { name: "حفظ" }).click();
    await expect(edit.getByTestId("action-msg")).toHaveAttribute(
      "data-ok",
      "1",
    );
    expect(
      (
        await db
          .from("photo_albums")
          .select("published_at")
          .eq("id", older.id)
          .single()
      ).data!.published_at,
    ).toBe(older.published_at);
    expect(await firstAlbumOnPhotos(page)).toBe(SLUG);
  } finally {
    await db
      .from("photo_albums")
      .update({ title: older.title })
      .eq("id", older.id);
    await admin.close();
  }
});

test("AP3: hero «newest album» follows publish and hide; manual restores the owner's photo", async ({
  browser,
  page,
}) => {
  await skipSiteIntro(page);
  const admin = await newLoggedIn(browser, "owner", "/admin/content/home");
  const form = admin.getByTestId("home-form");
  await form
    .locator("input[name=hero_cover_source][value=latest_album]")
    .check();
  await form.getByRole("button", { name: /حفظ/ }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");

  await page.goto(`${BASE}/`);
  const hero = page.locator("[data-hero-intro] > img").first();
  await expect(hero).toHaveAttribute("src", `/p/${photoId}/display`);
  const res = await page.request.get(`${BASE}/p/${photoId}/display`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cdn-cache-control"]).toBe("no-store");

  // hide the album → the hero moves on to the next newest album, and the hidden photo is no longer served
  await admin.goto(`${BASE}/admin/albums/${albumId}`);
  await admin
    .getByTestId("album-unpublish")
    .getByRole("button", { name: "إخفاء الألبوم" })
    .click();
  await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect(admin.getByTestId("album-publish")).toBeVisible();
  await page.goto(`${BASE}/`);
  await expect(hero).not.toHaveAttribute("src", `/p/${photoId}/display`);
  expect(
    (await page.request.get(`${BASE}/p/${photoId}/display`)).status(),
  ).toBe(404);
  // republish keeps the ORIGINAL publish time
  const before = (
    await db
      .from("photo_albums")
      .select("published_at")
      .eq("id", albumId)
      .single()
  ).data!.published_at;
  await admin
    .getByTestId("album-publish")
    .getByRole("button", { name: "نشر الألبوم" })
    .click();
  await admin.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect(admin.getByTestId("album-unpublish")).toBeVisible();
  expect(
    (
      await db
        .from("photo_albums")
        .select("published_at")
        .eq("id", albumId)
        .single()
    ).data!.published_at,
  ).toBe(before);

  // back to manual: the owner's stored choice is used again (it was never cleared)
  await admin.goto(`${BASE}/admin/content/home`);
  await form.locator("input[name=hero_cover_source][value=manual]").check();
  await form.getByRole("button", { name: /حفظ/ }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  const s = (
    await db
      .from("business_settings")
      .select("hero_cover_photo_id")
      .eq("id", 1)
      .single()
  ).data!;
  expect(s.hero_cover_photo_id).toBe(heroBefore!.hero_cover_photo_id);
  await page.goto(`${BASE}/`);
  if (s.hero_cover_photo_id)
    await expect(hero).toHaveAttribute(
      "src",
      `/p/${s.hero_cover_photo_id}/display`,
    );
  await admin.close();
});

test("RL1: promos as vertical reels — nothing loads before opening, one player, keyboard, Esc, deep link, Back", async ({
  browser,
  page,
}) => {
  await skipSiteIntro(page);
  // This database may have no promos: mark three published videos as «both» for the test (restored below). Saving the
  // home form unchanged expires the public videos cache (saveHome → TAGS.videos), as an owner edit would.
  const promos =
    (
      await db
        .from("showcase_videos")
        .select("id")
        .in("role", ["promo", "both"])
        .eq("is_published", true)
    ).data ?? [];
  const borrowed = promos.length
    ? []
    : (
        (
          await db
            .from("showcase_videos")
            .select("id")
            .eq("is_published", true)
            .eq("role", "work")
            .limit(3)
        ).data ?? []
      ).map((v) => v.id);
  const expireVideos = async () => {
    const owner = await newLoggedIn(browser, "owner", "/admin/content/home");
    const form = owner.getByTestId("home-form");
    await form.getByRole("button", { name: /حفظ/ }).click();
    await expect(form.getByTestId("action-msg")).toHaveAttribute(
      "data-ok",
      "1",
    );
    await owner.close();
  };
  if (borrowed.length) {
    await db
      .from("showcase_videos")
      .update({ role: "both" })
      .in("id", borrowed);
    await expireVideos();
  }
  try {
    await blockYouTube(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/work?tab=promos`);
    const open = page.locator("[data-reels-open]");
    test.skip(
      (await open.count()) === 0,
      "no published promos in this database",
    );
    await expect(page.locator("[data-reels-viewer]")).toHaveCount(0);
    await expect(page.locator("iframe[src*='enablejsapi']")).toHaveCount(0);

    await open.click();
    const viewer = page.locator("[data-reels-viewer]");
    await expect(viewer).toBeVisible();
    await expect(viewer.locator("iframe")).toHaveCount(1); // only the visible reel
    await expect(viewer.locator("iframe")).toHaveAttribute(
      "src",
      /autoplay=1&mute=1/,
    );
    await expect(page.locator("[data-reels-close]")).toBeFocused();
    await expect(page.locator("[data-reels-mute]")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const first = new URL(page.url()).searchParams.get("reel");
    expect(first).toBeTruthy();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    const count = await viewer.locator("[data-reel]").count();
    if (count > 1) {
      await page.keyboard.press("ArrowDown");
      await expect
        .poll(() => new URL(page.url()).searchParams.get("reel"))
        .not.toBe(first);
      await expect(viewer.locator("iframe")).toHaveCount(1);
      await expect(
        viewer.locator("[data-reel][data-active='1'] iframe"),
      ).toHaveCount(1);
    }
    const deep = page.url();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("reel")).toBeNull();
    await expect(open).toBeFocused();

    // shared link opens the same reel; Back from a reel opened in-site closes it
    await page.goto(deep);
    await expect(page.locator("[data-reels-viewer]")).toBeVisible();
    await page.locator("[data-reels-close]").click();
    await expect(page.locator("[data-reels-viewer]")).toHaveCount(0);
    await open.click();
    await expect(page.locator("[data-reels-viewer]")).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-reels-viewer]")).toHaveCount(0);
    await expect(page).toHaveURL(/tab=promos/);
  } finally {
    if (borrowed.length) {
      await db
        .from("showcase_videos")
        .update({ role: "work" })
        .in("id", borrowed);
      await expireVideos();
    }
  }
});

test("FB1: Facebook page settings are owner-only and say «غير مربوط» without a connection", async ({
  browser,
}) => {
  const owner = await newLoggedIn(browser, "owner", "/admin/settings/facebook");
  await expect(owner.getByTestId("facebook-connection")).toHaveAttribute(
    "data-status",
    "none",
  );
  await expect(owner.getByTestId("facebook-connection")).toContainText(
    "غير مربوط",
  );
  await owner.close();
  const admin = await newLoggedIn(browser, "admin", "/admin/settings/facebook");
  await expect(admin.getByTestId("facebook-connection")).toHaveCount(0);
  await admin.close();
});
