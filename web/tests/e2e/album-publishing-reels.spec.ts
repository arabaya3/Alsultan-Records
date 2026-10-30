import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { anon, BASE, db, hideAlbumViaAdmin, newLoggedIn, skipSiteIntro } from "./qa-helpers";

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
const copied: string[] = [];
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
/** The hero backdrop on a fresh home load. Retried: expireAgainAfterSettling allows a few seconds when a render was in flight. */
const HERO = "[data-hero-intro] > img, [data-hero-intro] > picture img";
const expectHomeHero = (page: Page, id: string) =>
  expect
    .poll(
      async () => {
        await page.goto(`${BASE}/`);
        return page.locator(HERO).first().getAttribute("src");
      },
      { timeout: 12_000, intervals: [500, 1000, 2000] },
    )
    .toBe(`/p/${id}/display`);
/** Published photos that are no album's chosen cover. */
async function manualHeroFixtures() {
  const covers = ((await db.from("photo_albums").select("cover_photo_id")).data ?? []).map((a) => a.cover_photo_id);
  const rows = (await db.from("album_photos").select("id, album_id, sort_order").eq("is_published", true).eq("upload_status", "ready").neq("album_id", albumId).order("sort_order", { ascending: false }).limit(200)).data!;
  return rows.filter((p) => !covers.includes(p.id));
}
const saveHeroSource = async (admin: Page, source: "manual" | "latest_album") => {
  await admin.goto(`${BASE}/admin/content/home`);
  const form = admin.getByTestId("home-form");
  await form.locator(`input[name=hero_cover_source][value=${source}]`).check();
  await form.getByRole("button", { name: /حفظ/ }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
};
const blockYouTube = (page: Page) =>
  page.route(/youtube(-nocookie)?\.com|ytimg\.com/, (r) => r.abort());

test.beforeAll(async () => {
  // A real, processed photo whose variant FILES are copied to this photo's own paths (two rows never share an
  // object, as in real use), so the album renders like any other.
  const candidates = (
    await db.from("album_photos").select("variants, width, height, mime, bytes").eq("upload_status", "ready").not("variants", "is", null).limit(30)
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
  // Use the first candidate whose stored files all exist (a local stack can hold rows whose files were removed).
  let src: (typeof candidates)[number] | null = null;
  const variants: Record<string, string> = {};
  for (const cand of candidates) {
    const done: string[] = [];
    for (const from of Object.values(cand.variants as Record<string, string>)) {
      const to = `albums/${albumId}/${photoId}/${from.split("/").pop()}`;
      if ((await db.storage.from("album-media").copy(from, to)).error) break;
      done.push(to);
    }
    if (done.length === Object.keys(cand.variants as object).length) {
      src = cand;
      Object.keys(cand.variants as object).forEach((k, i) => (variants[k] = done[i]!));
      copied.push(...done);
      break;
    }
    if (done.length) await db.storage.from("album-media").remove(done);
  }
  if (!src) throw new Error("no processed photo with its files in this stack");
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
      variants,
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
  featuredBefore = sec.featured_ids ?? [];
  heroBefore = (
    await db
      .from("business_settings")
      .select("hero_cover_source, hero_cover_photo_id")
      .eq("id", 1)
      .single()
  ).data!;
});

test.afterAll(async ({ browser }) => {
  if (albumId) await hideAlbumViaAdmin(browser, albumId); // expires the public albums cache before the rows go
  if (featuredBefore) {
    await db.from("site_sections").update({ featured_ids: featuredBefore }).eq("key", "albums");
    await saveAlbumsSection(browser);
  }
  if (heroBefore) {
    await db.from("business_settings").update(heroBefore).eq("id", 1);
    const o = await newLoggedIn(browser, "owner", "/admin/content/home");
    await saveHeroSource(o, heroBefore.hero_cover_source as "manual" | "latest_album");
    await o.close();
  }
  if (albumId) {
    await db
      .from("photo_albums")
      .update({ cover_photo_id: null })
      .eq("id", albumId);
    await db.from("album_photos").delete().eq("album_id", albumId);
    await db.from("photo_albums").delete().eq("id", albumId);
  }
  if (copied.length) await db.storage.from("album-media").remove(copied);
});

/** Re-save the home «albums» section as the owner would: keeps the stored picks, expires the sections cache. */
async function saveAlbumsSection(browser: import("@playwright/test").Browser) {
  const o = await newLoggedIn(browser, "owner", "/admin/content/nav");
  const form = o.getByTestId("section-albums");
  await form.getByRole("button", { name: /حفظ/ }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await o.close();
}

async function firstAlbumOnPhotos(page: Page) {
  await page.goto(`${BASE}/work?tab=photos`);
  return page
    .locator("[data-album-grid] [data-album-card]")
    .first()
    .getAttribute("data-album-card");
}

/** What the public home «latest albums» section must show: as anon (same RLS as the site), albums with at least one
 *  visible photo, strictly listed_at desc, id desc, capped at the section limit. */
async function expectedHomeAlbums(limit: number): Promise<string[]> {
  const a = anon();
  const [albums, photos] = await Promise.all([
    a.from("photo_albums").select("id, slug").order("listed_at", { ascending: false }).order("id", { ascending: false }),
    a.from("album_photos").select("album_id"),
  ]);
  const withPhotos = new Set((photos.data ?? []).map((p) => p.album_id as string));
  return (albums.data ?? []).filter((x) => withPhotos.has(x.id)).slice(0, limit).map((x) => x.slug as string);
}

test("AP1: a year-old occasion published today comes first; home is strictly by latest publish; old manual picks stay saved but are not mixed in", async ({
  browser,
  page,
}) => {
  await skipSiteIntro(page);
  expect(await firstAlbumOnPhotos(page)).not.toBe(SLUG); // draft: not public
  // Old manual picks for the home section: the two oldest published albums with photos.
  const old = (
    await db.from("photo_albums").select("id, slug").eq("is_published", true).is("deleted_at", null).is("archived_at", null)
      .order("listed_at", { ascending: true }).limit(6)
  ).data!;
  const withPhotos: { id: string; slug: string }[] = [];
  for (const a of old) {
    const n = (await db.from("album_photos").select("id", { count: "exact", head: true }).eq("album_id", a.id).eq("is_published", true).eq("upload_status", "ready")).count ?? 0;
    if (n > 0) withPhotos.push(a);
    if (withPhotos.length === 2) break;
  }
  const picks = withPhotos.map((a) => a.id);
  await db.from("site_sections").update({ featured_ids: picks }).eq("key", "albums");
  await saveAlbumsSection(browser);
  const section = (await db.from("site_sections").select("featured_ids, item_limit").eq("key", "albums").single()).data!;
  const stored: string[] = section.featured_ids;
  expect([...stored].sort()).toEqual([...picks].sort());
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
  const cards = await page.locator("[data-home-section=albums] [data-album-card]").evaluateAll((as) => as.map((a) => a.getAttribute("data-album-card")));
  const expected = await expectedHomeAlbums(section.item_limit);
  expect(expected[0]).toBe(SLUG);
  expect(expected.length).toBeGreaterThan(stored.length + 1); // enough albums that mixing the picks in would change the order
  expect(cards).toEqual(expected); // the FULL chronological order, not «newest, then the picks»
  // the picks are the two OLDEST albums: they must not be pulled up into the latest section
  const pickSlugs = withPhotos.map((a) => a.slug);
  for (const slug of pickSlugs) if (!expected.includes(slug)) expect(cards).not.toContain(slug);
  expect((await db.from("site_sections").select("featured_ids").eq("key", "albums").single()).data!.featured_ids).toEqual(stored); // publishing never touches the picks
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
  const [manual] = await manualHeroFixtures();
  await db.from("business_settings").update({ hero_cover_photo_id: manual.id, hero_cover_source: "manual" }).eq("id", 1);
  const admin = await newLoggedIn(browser, "owner", "/admin/content/home");
  await saveHeroSource(admin, "latest_album");

  await expectHomeHero(page, photoId);
  const hero = page.locator(HERO).first();
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
  await expect
    .poll(
      async () => {
        await page.goto(`${BASE}/`);
        return hero.getAttribute("src");
      },
      { timeout: 12_000, intervals: [500, 1000, 2000] },
    )
    .not.toBe(`/p/${photoId}/display`);
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
  await saveHeroSource(admin, "manual");
  const s = (
    await db
      .from("business_settings")
      .select("hero_cover_photo_id")
      .eq("id", 1)
      .single()
  ).data!;
  expect(s.hero_cover_photo_id).toBe(manual.id);
  await expectHomeHero(page, manual.id);
  await admin.close();
});

test("AP3b: switching hero modes and picking a manual photo reach the home page promptly after each save", async ({
  browser,
  page,
}) => {
  await skipSiteIntro(page);
  const [first, second] = await manualHeroFixtures();
  await db.from("business_settings").update({ hero_cover_photo_id: first.id, hero_cover_source: "manual" }).eq("id", 1);
  const admin = await newLoggedIn(browser, "owner", "/admin/content/home");
  await saveHeroSource(admin, "manual");
  await expectHomeHero(page, first.id);
  await saveHeroSource(admin, "latest_album");
  await expectHomeHero(page, photoId);
  await saveHeroSource(admin, "manual");
  await expectHomeHero(page, first.id);

  // Pick another photo in the admin picker, as the owner does.
  const title = (await db.from("photo_albums").select("title").eq("id", second.album_id).single()).data!.title;
  await admin.goto(`${BASE}/admin/content/home`);
  const picker = admin.getByTestId("picker-hero_cover_photo_id");
  await picker.getByRole("button", { name: "اختيار صورة" }).click();
  await picker.getByRole("combobox").selectOption({ label: title });
  await picker.locator(`button:has(img[src="/p/${second.id}/thumb"])`).click();
  const form = admin.getByTestId("home-form");
  await form.getByRole("button", { name: /حفظ/ }).click();
  await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
  await expectHomeHero(page, second.id);
  await admin.close();
});

test("PC1: withdrawn photo — the copy already on screen stays, but a new request and a page reload both get 404 (no 5-minute window)", async ({ page }) => {
  await skipSiteIntro(page);
  const st = (await db.from("photo_albums").select("is_published").eq("id", albumId).single()).data!;
  expect(st.is_published).toBe(true); // published by AP1/AP3
  const thumb = `/p/${photoId}/thumb`;
  const first = page.waitForResponse((r) => r.url().endsWith(thumb));
  await page.goto(`${BASE}/work/albums/${SLUG}`);
  const ok = await first;
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toBe("private, no-cache");
  const img = page.locator(`[data-album-photo="${photoId}"] img`);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  await db.from("album_photos").update({ is_published: false }).eq("id", photoId);
  try {
    // Already on screen: nothing can take it back (documented), and the page does not need to.
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    // A new request (e.g. another tab, a shared link) → 404 no-store, immediately.
    const fresh = await page.request.get(`${BASE}${thumb}`);
    expect(fresh.status()).toBe(404);
    expect(fresh.headers()["cache-control"]).toBe("no-store");
    // Reload: the browser must revalidate its stored copy (no-cache) → the server says 404, the stale copy is not used.
    const again = page.waitForResponse((r) => r.url().endsWith(thumb), { timeout: 20_000 }).catch(() => null);
    await page.reload();
    const r = await again;
    if (r) expect(r.status()).toBe(404); // the page may also drop the card once the album cache refreshes
    expect(await page.evaluate((u) => fetch(u, { cache: "default" }).then((x) => x.status), thumb)).toBe(404);
  } finally {
    await db.from("album_photos").update({ is_published: true }).eq("id", photoId);
  }
});

test("RL1: promos — launch gate off by default; when on: vertical reels, nothing loads before opening, one player, keyboard, Esc, deep link, Back", async ({
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
    await expect(page.locator("[data-promo-grid] li").first()).toBeVisible();
    // Launch gate (REELS_VIEWER, same value for the app and this run): OFF by default until real YouTube playback is
    // verified on phones. OFF → no launcher and a shared ?reel= link opens nothing; the promo grid works as before.
    if (process.env.REELS_VIEWER !== "1") {
      await expect(open).toHaveCount(0);
      const id = (await db.from("showcase_videos").select("id").in("role", ["promo", "both"]).eq("is_published", true).limit(1).single()).data!.id;
      await page.goto(`${BASE}/work?tab=promos&reel=${id}`);
      await expect(page.locator("[data-promo-grid] li").first()).toBeVisible();
      await expect(page.locator("[data-reels-viewer]")).toHaveCount(0);
      await expect(page.locator("iframe")).toHaveCount(0);
      return;
    }
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
