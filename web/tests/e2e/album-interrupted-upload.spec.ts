import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { db, newLoggedIn, revalidatePublic } from "./qa-helpers";

/**
 * Interrupted album upload (production incident 2026-10-20: 67 of 95 photos never reached storage after the upload
 * page was left). The dead rows (failed, «original not found», no object) must NOT block re-uploading the same
 * files: re-selecting a photo replaces its dead row and uploads it. A real photo (original stored) still counts as
 * a duplicate. The admin shows an Arabic explanation instead of the raw error. Cleans up everything it creates.
 *   BASE_URL=http://localhost:3600 npx playwright test album-interrupted-upload
 */
const BUCKET = "album-media";
const ALBUM = { id: randomUUID(), slug: `e2e-interrupted-${Date.now().toString(36)}` };

async function jpeg(color: string) {
  return sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).jpeg({ quality: 80 }).toBuffer();
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test.afterAll(async () => {
  const { data: ps } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", ALBUM.id);
  const paths = (ps ?? []).flatMap((p) => [p.storage_path_original, ...Object.values((p.variants ?? {}) as Record<string, string>)]);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
  await db.from("album_photos").delete().eq("album_id", ALBUM.id);
  await db.from("photo_albums").delete().eq("id", ALBUM.id);
});

test("IU1: a dead (never-uploaded) photo is replaced when the same file is chosen again; a real photo stays a duplicate", async ({ browser }) => {
  const lost = await jpeg("#5a3d22");
  const deadId = randomUUID();
  expect((await db.from("photo_albums").insert({ id: ALBUM.id, slug: ALBUM.slug, title: "ألبوم رفع منقطع (اختبار)", is_published: false })).error).toBeNull();
  // The state left by an interrupted session: row created, original never uploaded, processor marked it failed.
  const ins = await db.from("album_photos").insert({
    id: deadId,
    album_id: ALBUM.id,
    storage_path_original: `albums/${ALBUM.id}/${deadId}/original.jpg`,
    mime: "image/jpeg",
    bytes: lost.length,
    sha256: sha(lost),
    sort_order: 10,
    upload_status: "failed",
    last_error: "original not found in storage",
  });
  expect(ins.error).toBeNull();

  const page = await newLoggedIn(browser, "owner", `/admin/albums/${ALBUM.id}`);
  await expect(page.getByTestId("photo-error").first()).toContainText("اختر نفس الصورة مرة ثانية");

  // Choose the same file again → uploaded (not «skipped») INTO THE SAME reserved row (0025 album_upload_reopen:
  // same id/path, so a partial TUS upload could resume), exactly one photo with that hash.
  await page.getByTestId("album-upload-input").setInputFiles([{ name: "lost.jpg", mimeType: "image/jpeg", buffer: lost }]);
  await page.getByTestId("album-upload-start").click();
  await expect(page.locator('[data-testid="album-upload-row"][data-state="ready"]')).toHaveCount(1, { timeout: 120_000 });
  const rows = (await db.from("album_photos").select("id, upload_status").eq("album_id", ALBUM.id).eq("sha256", sha(lost))).data!;
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(deadId); // reopened, not replaced (since 0025)
  expect(rows[0].upload_status).toBe("ready");

  // Choosing it once more: now a real, stored photo → still a duplicate (skipped).
  await page.getByTestId("album-upload-input").setInputFiles([{ name: "lost-again.jpg", mimeType: "image/jpeg", buffer: lost }]);
  await page.getByTestId("album-upload-start").click();
  await expect(page.locator('[data-testid="album-upload-row"][data-state="skipped"]')).toHaveCount(1, { timeout: 60_000 });
  expect((await db.from("album_photos").select("id").eq("album_id", ALBUM.id).eq("sha256", sha(lost))).data).toHaveLength(1);
  await page.context().close();
});

// this suite seeds/removes albums directly in the DB: expire the public album cache through the app afterwards, so
// no later page shows an album that no longer exists (what the admin actions do with updateTag)
test.beforeAll(() => revalidatePublic(["photo-albums"]));
test.afterAll(() => revalidatePublic(["photo-albums"]));
