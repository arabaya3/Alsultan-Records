import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { anon, as, db, newLoggedIn, PUB_KEY, SB_URL } from "./qa-helpers";

/**
 * Admin photo albums (local stack, seed users). Run: BASE_URL=http://localhost:3400 npx playwright test admin-albums
 * Creates album slug `e2e-album`, uploads generated images (incl. one invalid + one oversized), checks
 * per-file results, variants, reorder/cover/hide, publish gating of rows AND storage objects for anon,
 * then deletes the album and verifies its storage objects are gone.
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
  await expect(page.getByRole("link", { name: "الألبومات" }).first()).toBeVisible();
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
  await expect(page.getByTestId("album-upload-summary")).toHaveText("اكتمل 2، فشل 1 من 3.", { timeout: 120_000 });
  await expect(page.locator('[data-testid="album-upload-row"][data-state="failed"]')).toHaveCount(1);

  const photos = async () =>
    (await db.from("album_photos").select("id, width, height, variants, sort_order, is_published, upload_status, storage_path_original").eq("album_id", a.id).order("sort_order")).data!;
  let ps = await photos();
  expect(ps).toHaveLength(2);
  expect(ps[0]).toMatchObject({ width: 2400, height: 1600, upload_status: "ready" });
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

  // reorder: move the second photo up
  await page.reload();
  const second = page.locator(`[data-testid=album-photo][data-photo-id="${ps[1].id}"]`);
  await second.getByRole("button", { name: "↑ تقديم" }).click();
  await expect.poll(async () => (await photos())[0].id).toBe(ps[1].id);

  // cover
  await page.reload();
  await page.locator(`[data-testid=album-photo][data-photo-id="${ps[0].id}"]`).getByRole("button", { name: "غلاف" }).click();
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

  // delete a photo: storage objects removed
  const bigId = ps[0].id;
  ps = await photos();
  const victim = ps.find((p) => p.id !== bigId && p.is_published)!;
  const victimPaths = [victim.storage_path_original, ...Object.values(victim.variants as Record<string, string>)];
  await page.reload();
  await page.locator(`[data-testid=album-photo][data-photo-id="${victim.id}"]`).getByRole("button", { name: "حذف" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await photos()).length).toBe(1);
  for (const p of victimPaths) expect((await db.storage.from(BUCKET).download(p)).error).not.toBeNull();

  // hide album (confirm)
  await page.reload();
  await page.getByTestId("album-unpublish").getByRole("button", { name: "إخفاء الألبوم" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await expect.poll(async () => (await anon().from("photo_albums").select("id").eq("slug", SLUG)).data?.length).toBe(0);

  // delete album: rows + objects gone
  const left = await photos();
  await page.reload();
  await page.getByTestId("album-delete").getByRole("button", { name: "حذف الألبوم وكل صوره" }).click();
  await page.locator("dialog[open] [data-testid=confirm-yes]").click();
  await page.waitForURL((u) => u.pathname === "/admin/albums");
  expect((await db.from("photo_albums").select("id").eq("id", a.id)).data).toHaveLength(0);
  for (const p of left) expect((await db.storage.from(BUCKET).download(p.storage_path_original)).error).not.toBeNull();
  await page.context().close();
});

test("A3: staff and customers are denied (UI + API + storage)", async ({ browser }) => {
  const staff = await newLoggedIn(browser, "staff", "/admin");
  await staff.goto("/admin/albums");
  await expect(staff.getByTestId("forbidden")).toBeVisible();
  await expect(staff.getByRole("link", { name: "الألبومات" })).toHaveCount(0);
  await staff.context().close();
  for (const who of ["staff", "a"] as const) {
    const c = await as(who);
    expect((await c.from("photo_albums").insert({ slug: "nope-album", title: "ممنوع" })).error).not.toBeNull();
    expect((await c.storage.from(BUCKET).upload("albums/x/y/original.jpg", Buffer.from("x"), { contentType: "image/jpeg" })).error).not.toBeNull();
  }
});
