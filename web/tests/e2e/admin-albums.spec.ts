import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { anon, as, db, newLoggedIn, PUB_KEY, SB_URL } from "./qa-helpers";

/**
 * Admin photo albums (local stack, seed users). Run: BASE_URL=http://localhost:3400 npx playwright test admin-albums
 * Creates album slug `e2e-album`, uploads generated images (incl. one invalid + one oversized), checks
 * per-file results, variants, reorder/cover/hide, publish gating of rows AND storage objects for anon,
 * dedupe, trash/restore, preview, archive/trash/purge (slug confirmation; storage cleanup is queued by purge_album).
 */
test.describe.configure({ mode: "serial" });

const SLUG = "e2e-album";
const BUCKET = "album-media";

async function cleanup() {
  const { data: a } = await db.from("photo_albums").select("id").eq("slug", SLUG).maybeSingle();
  if (!a) return;
  const { data: ps } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", a.id);
  const paths = (ps ?? []).flatMap((p) => [p.storage_path_original, ...Object.values((p.variants ?? {}) as Record<string, string>)]);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
  await db.from("photo_albums").delete().eq("id", a.id);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function jpeg(w: number, h: number, color: string) {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();
}

/** Anonymous storage read (same call the public route makes with the publishable key). */
async function anonObject(path: string) {
  const r = await fetch(`${SB_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`, {
    headers: { apikey: PUB_KEY, Authorization: `Bearer ${PUB_KEY}` },
  });
  await r.body?.cancel();
  return r.status;
}

test("A1: nav entry, create album (hidden by default)", async ({ browser }) => {
  const page = await newLoggedIn(browser, "admin", "/admin/albums");
  await expect(page.getByRole("heading", { level: 1, name: "الألبومات" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ألبومات الصور" }).first()).toBeVisible();
  const form = page.getByTestId("album-create");
  await form.locator('input[name="title"]').fill("ألبوم اختبار");
  await form.locator('input[name="slug"]').fill(SLUG);
  await form.locator('input[name="source_label"]').fill("فيسبوك — ستوديو السلطان");
  await form.locator('input[name="source_url"]').fill("https://www.facebook.com/Sultan.Rec0rds2");
  await form.locator('textarea[name="rights_note"]').fill("موافقة خطية من العائلة");
  await form.getByRole("button", { name: "إنشاء الألبوم" }).click();
  await page.waitForURL(/\/admin\/albums\/[0-9a-f-]{36}$/);
  const a = (await db.from("photo_albums").select("id, is_published").eq("slug", SLUG).single()).data!;
  expect(a.is_published).toBe(false);
  expect((await anon().from("photo_albums").select("id").eq("slug", SLUG)).data).toHaveLength(0);
  expect((await anon().from("photo_albums").select("rights_note")).error).not.toBeNull();
  await page.context().close();
});

test("A2: bulk upload with per-file results, variants, reorder, cover, hide, publish, delete", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = (await db.from("photo_albums").select("id").eq("slug", SLUG).single()).data!;
  const page = await newLoggedIn(browser, "admin", `/admin/albums/${a.id}`);
  await expect(page.getByTestId("album-uploader")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("album-upload-input").setInputFiles([
    { name: "one.jpg", mimeType: "image/jpeg", buffer: await jpeg(2400, 1600, "#b08d57") },
    { name: "two.jpg", mimeType: "image/jpeg", buffer: await jpeg(900, 1200, "#20304a") },
    { name: "bad.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") },
  ]);
  await page.getByTestId("album-upload-start").click();
  await expect(page.locator('[data-testid="album-upload-row"][data-state="ready"]')).toHaveCount(2, { timeout: 120_000 });
  await expect(page.locator('[data-testid="album-upload-row"][data-state="failed"]')).toHaveCount(1);
  await expect(page.getByTestId("album-upload-summary")).toContainText("جاهز 2");

  // duplicate in the same album (sha256) → skipped, nothing new stored
  const again = await jpeg(2400, 1600, "#b08d57");
  await page.getByTestId("album-upload-input").setInputFiles([{ name: "one-again.jpg", mimeType: "image/jpeg", buffer: again }]);
  await page.getByTestId("album-upload-start").click();
  await expect(page.locator('[data-testid="album-upload-row"][data-state="skipped"]')).toHaveCount(1, { timeout: 60_000 });

  const photos = async () =>
    (await db.from("album_photos").select("id, width, height, variants, sort_order, is_published, upload_status, storage_path_original").eq("album_id", a.id).order("sort_order")).data!;
  let ps = await photos();
  expect(ps).toHaveLength(2);
  expect(ps[0]).toMatchObject({ width: 2400, height: 1600, upload_status: "ready" });
  expect((await db.from("album_photos").select("sha256").eq("id", ps[0].id).single()).data!.sha256).toMatch(/^[0-9a-f]{64}$/);
  const v = ps[0].variants as Record<string, string>;
  expect(v.thumb).toMatch(/\/thumb\.webp$/);
  expect(v.display).toMatch(/\/display\.webp$/);
  const thumbMeta = await sharp(Buffer.from(await (await db.storage.from(BUCKET).download(v.thumb)).data!.arrayBuffer())).metadata();
  expect(Math.max(thumbMeta.width!, thumbMeta.height!)).toBe(480);
  // the original is kept byte-for-byte untouched (same dimensions, JPEG)
  const orig = await sharp(Buffer.from(await (await db.storage.from(BUCKET).download(ps[0].storage_path_original)).data!.arrayBuffer())).metadata();
  expect(orig).toMatchObject({ format: "jpeg", width: 2400, height: 1600 });

  // hidden album: anon sees no rows and cannot read objects
  expect((await anon().from("album_photos").select("id").eq("album_id", a.id)).data).toHaveLength(0);
  expect(await anonObject(v.thumb)).not.toBe(200);

  // reorder (the «ترتيب الصور» view is the one place to order): move the second photo up, nothing saved until «حفظ الترتيب»
  await page.reload();
  await page.getByTestId("photo-view-order").click();
  const second = page.locator(`[data-testid=photo-reorder] li[data-photo-id="${ps[1].id}"]`);
  await second.getByRole("button", { name: /^تقديم/ }).click();
  expect((await photos())[0].id).toBe(ps[0].id);
  await page.getByTestId("photo-reorder-save").click();
  await expect.poll(async () => (await photos())[0].id).toBe(ps[1].id);
  await expect(page.getByTestId("photo-reorder-msg")).toBeVisible(); // saved (the page refresh after a save has run)
  await page.getByTestId("photo-view-details").click();
  await expect(page.getByTestId("album-photos")).toBeVisible();

  // cover
  await page.reload();
  await page.locator(`[data-testid=album-photo][data-photo-id="${ps[0].id}"]`).getByRole("button", { name: "تعيين كغلاف" }).click();
  await expect.poll(async () => (await db.from("photo_albums").select("cover_photo_id").eq("id", a.id).single()).data!.cover_photo_id).toBe(ps[0].id);

  // publish (confirm)
  await page.reload();
  await page.getByTestId("album-publish").getByRole("button", { name: "نشر الألبوم" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await anon().from("album_photos").select("id").eq("album_id", a.id)).data?.length).toBe(2);
  expect(await anonObject(v.thumb)).toBe(200);
  const pub = (await anon().from("photo_albums").select("id, slug, title, source_label, source_url, cover_photo_id").eq("slug", SLUG).single()).data!;
  expect(pub).toMatchObject({ source_label: "فيسبوك — ستوديو السلطان", cover_photo_id: ps[0].id });
  expect((await anon().from("album_photos").select("storage_path_original")).error).not.toBeNull();

  // hide one photo: its row and objects disappear for anon immediately
  await page.reload();
  await page.locator(`[data-testid=album-photo][data-photo-id="${ps[0].id}"]`).getByRole("button", { name: "إخفاء" }).click();
  await expect.poll(async () => (await anon().from("album_photos").select("id").eq("album_id", a.id)).data?.length).toBe(1);
  expect(await anonObject(v.thumb)).not.toBe(200);

  // trash a photo (soft delete): hidden for anon, files kept, restorable
  const bigId = ps[0].id;
  ps = await photos();
  const victim = ps.find((p) => p.id !== bigId && p.is_published)!;
  await page.reload();
  await page.locator(`[data-testid=album-photo][data-photo-id="${victim.id}"]`).getByTestId("photo-trash").getByRole("button").click();
  // explicit confirmation before anything moves to the trash
  expect((await db.from("album_photos").select("deleted_at").eq("id", victim.id).single()).data!.deleted_at).toBeNull();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await db.from("album_photos").select("deleted_at").eq("id", victim.id).single()).data!.deleted_at).not.toBeNull();
  expect((await anon().from("album_photos").select("id").eq("id", victim.id)).data).toHaveLength(0);
  expect((await db.storage.from(BUCKET).download(victim.storage_path_original)).error).toBeNull();
  await page.reload();
  await page.getByTestId("album-trashed-photos").getByRole("button", { name: "استرجاع" }).click();
  await expect.poll(async () => (await db.from("album_photos").select("deleted_at").eq("id", victim.id).single()).data!.deleted_at).toBeNull();

  // preview renders drafts for the admin
  await page.goto(`/admin/albums/${a.id}/preview`);
  await expect(page.getByTestId("album-preview")).toBeVisible();

  // hide album (confirm)
  await page.goto(`/admin/albums/${a.id}`);
  await page.getByTestId("album-unpublish").getByRole("button", { name: "إخفاء الألبوم" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await anon().from("photo_albums").select("id").eq("slug", SLUG)).data?.length).toBe(0);

  // archive → restore; trash → restore; trash → purge (typing the slug)
  for (const [op, label] of [["archive", "أرشفة"], ["unarchive", "إخراج من الأرشيف"], ["trash", "نقل إلى سلة المحذوفات"], ["untrash", "استرجاع من سلة المحذوفات"], ["trash", "نقل إلى سلة المحذوفات"]] as const) {
    await page.goto(`/admin/albums/${a.id}`);
    await page.getByTestId(`album-${op}`).getByRole("button", { name: label }).click();
    const dlg = page.locator("dialog[open] [data-testid=confirm-yes]");
    if (await dlg.isVisible().catch(() => false)) await dlg.click();
    const want = op === "archive" ? "archived_at" : op === "trash" ? "deleted_at" : null;
    await expect.poll(async () => {
      const r = (await db.from("photo_albums").select("archived_at, deleted_at").eq("id", a.id).single()).data!;
      return want ? r[want] !== null : r.archived_at === null && r.deleted_at === null;
    }).toBe(true);
  }
  await page.goto(`/admin/albums/${a.id}`);
  await page.getByTestId("album-purge-slug").fill("wrong-slug");
  await page.getByTestId("album-purge").getByRole("button", { name: "حذف نهائي" }).click();
  expect((await db.from("photo_albums").select("id").eq("id", a.id)).data).toHaveLength(1);
  await page.getByTestId("album-purge-slug").fill(SLUG);
  await page.getByTestId("album-purge").getByRole("button", { name: "حذف نهائي" }).click();
  await page.waitForURL((u) => u.pathname === "/admin/albums");
  expect((await db.from("photo_albums").select("id").eq("id", a.id)).data).toHaveLength(0);
  await page.context().close();
});

test("A3: staff and customers are denied (UI + API + storage)", async ({ browser }) => {
  const staff = await newLoggedIn(browser, "staff", "/admin");
  await staff.goto("/admin/albums");
  await expect(staff.getByTestId("forbidden")).toBeVisible();
  await expect(staff.getByRole("link", { name: "ألبومات الصور" })).toHaveCount(0);
  await staff.context().close();
  for (const who of ["staff", "a"] as const) {
    const c = await as(who);
    expect((await c.from("photo_albums").insert({ slug: "nope-album", title: "ممنوع" })).error).not.toBeNull();
    expect((await c.storage.from(BUCKET).upload("albums/x/y/original.jpg", Buffer.from("x"), { contentType: "image/jpeg" })).error).not.toBeNull();
  }
});
