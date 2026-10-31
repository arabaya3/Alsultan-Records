import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test, type Page } from "@playwright/test";
import { db, newLoggedIn, psql, USERS } from "./qa-helpers";

/**
 * Album photos on S3, against a local S3 emulator with synthetic images only. LOCAL STACK ONLY.
 * The app must run with ALBUM_STORAGE_WRITE=s3 and the same S3_* values as this process; without them the spec skips.
 * The emulator does not enforce bucket privacy or signed lengths: scripts/s3-check.mjs proves those on the real bucket.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(5 * 60_000);
test.skip(process.env.ALBUM_STORAGE_WRITE !== "s3" || !process.env.S3_ENDPOINT, "needs the app running with S3");

const Bucket = process.env.S3_BUCKET!;
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "x", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "x" },
});
const BASE = process.env.BASE_URL!;
const STAMP = Date.now().toString(36);
const created: string[] = [];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "album-s3-"));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const row = (page: Page, name: string) => page.locator(`[data-testid="album-upload-row"]:has([data-file-name="${name}"])`);

async function exists(key: string) {
  return s3.send(new HeadObjectCommand({ Bucket, Key: key })).then(() => true, () => false);
}
const getBytes = async (key: string) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket, Key: key }))).Body!.transformToByteArray());
const openUploads = async (prefix: string) => (await s3.send(new ListMultipartUploadsCommand({ Bucket, Prefix: prefix }))).Uploads?.length ?? 0;
const onSupabase = async (album: string) => (await db.storage.from("album-media").list(`albums/${album}`)).data?.length ?? 0;

/** A real JPEG, incompressible enough to span several parts, with camera metadata that must not reach the variants. */
async function bigJpeg(name: string, mb: number) {
  const w = Math.ceil(Math.sqrt((mb * 1024 * 1024) / 1.1 / 3 * 1.2));
  const raw = randomBytes(w * w * 3);
  const f = path.join(TMP, name);
  await sharp(raw, { raw: { width: w, height: w, channels: 3 } }).withExif({ IFD0: { Copyright: "secret-exif-marker" }, IFD3: { GPSLatitudeRef: "N" } }).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(f);
  return f;
}
async function newDraft(title: string) {
  const id = randomUUID();
  await db.from("photo_albums").insert({ id, slug: `e2e-s3-${title}-${STAMP}`, title: `اختبار S3 ${title}`, is_published: false });
  created.push(id);
  return id;
}
async function choose(page: Page, f: string) {
  await page.getByTestId("album-upload-input").setInputFiles(f);
  await page.getByTestId("album-upload-start").click();
}
async function ready(page: Page, name: string) {
  await expect(row(page, name)).toHaveAttribute("data-state", "ready", { timeout: 180_000 });
}
const photoRow = async (album: string) => (await db.from("album_photos").select("*").eq("album_id", album).order("created_at")).data ?? [];
const runJobs = () => fetch(`${BASE}/api/jobs/process-photos`, { method: "POST", headers: { "x-jobs-secret": process.env.JOBS_SECRET ?? "" } });

test.afterAll(async () => {
  await db.from("profiles").update({ role: "admin" }).eq("id", (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === USERS.admin.email)!.id);
  for (const id of created) {
    await db.from("album_photos").delete().eq("album_id", id);
    await db.from("photo_albums").delete().eq("id", id);
    const listed = (await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `albums/${id}/` }))).Contents ?? [];
    for (const o of listed) await s3.send(new DeleteObjectCommand({ Bucket, Key: o.Key }));
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

let album = "";
let photo: Record<string, never> & { id: string; storage_path_original: string; variants: { thumb: string; display: string } };

test("S1: a multi-part JPEG goes to S3 only; the stored original is identical; variants carry no camera metadata", async ({ browser }) => {
  album = await newDraft("main");
  const f = await bigJpeg("big.jpg", 20);
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${album}`);
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("partNumber")) puts.push(r.url());
  });
  await choose(page, f);
  await ready(page, "big.jpg");
  expect(puts.length).toBeGreaterThanOrEqual(2);
  expect(puts.some((u) => u.includes(new URL(BASE).host))).toBe(false); // bytes never pass through the app
  [photo] = (await photoRow(album)) as (typeof photo)[];
  expect((photo as unknown as { storage_provider: string }).storage_provider).toBe("s3");
  expect(sha(await getBytes(photo.storage_path_original))).toBe(sha(fs.readFileSync(f)));
  expect(await onSupabase(album)).toBe(0);
  for (const v of [photo.variants.thumb, photo.variants.display]) {
    const b = await getBytes(v);
    expect((await sharp(b).metadata()).format).toBe("webp");
    expect((await sharp(b).metadata()).exif).toBeUndefined();
    expect(b.includes("secret-exif-marker")).toBe(false);
  }
  await page.context().close();
});

test("S2: the same file is skipped as a duplicate", async ({ browser }) => {
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${album}`);
  await choose(page, path.join(TMP, "big.jpg"));
  await expect(row(page, "big.jpg")).toHaveAttribute("data-state", "skipped", { timeout: 60_000 });
  expect((await photoRow(album)).length).toBe(1);
  await page.context().close();
});

test("S3: /p is the only way in — published 200 private no-cache, 304 only while published, withdrawn and draft 404", async () => {
  const url = `${BASE}/p/${photo.id}/thumb`;
  expect((await fetch(url)).status).toBe(404); // draft
  await db.from("album_photos").update({ is_published: true }).eq("id", photo.id);
  await db.from("photo_albums").update({ is_published: true }).eq("id", album);
  const ok = await fetch(url);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("private, no-cache");
  expect(ok.headers.get("cdn-cache-control")).toBe("no-store");
  expect(ok.headers.get("content-type")).toBe("image/webp");
  const etag = ok.headers.get("etag")!;
  expect(etag).toBeTruthy();
  expect((await fetch(url, { headers: { "if-none-match": etag } })).status).toBe(304);
  expect((await fetch(`${BASE}/p/${photo.id}/original`)).status).toBe(404);
  await db.from("album_photos").update({ is_published: false }).eq("id", photo.id);
  const gone = await fetch(url, { headers: { "if-none-match": etag } });
  expect(gone.status).toBe(404);
  expect(gone.headers.get("cache-control")).toBe("no-store");
  await db.from("album_photos").update({ is_published: true }).eq("id", photo.id);
  await db.from("photo_albums").update({ is_published: false }).eq("id", album);
  expect((await fetch(url, { headers: { "if-none-match": etag } })).status).toBe(404);
  await db.from("photo_albums").update({ is_published: true }).eq("id", album);
});

test("S4: storage down → 503 no-store, never a false 404 or a cached image", async () => {
  const c = process.env.S3_TEST_CONTAINER;
  test.skip(!c, "S3_TEST_CONTAINER not set");
  execFileSync("docker", ["pause", c!]);
  try {
    const r = await fetch(`${BASE}/p/${photo.id}/thumb`, { signal: AbortSignal.timeout(20_000) });
    expect([503, 504]).toContain(r.status);
    expect(r.headers.get("cache-control")).toBe("no-store");
  } finally {
    execFileSync("docker", ["unpause", c!]);
  }
  expect((await fetch(`${BASE}/p/${photo.id}/thumb`)).status).toBe(200);
});

test("S5: reload mid-upload, same file again: stored parts are not sent again and the original is whole", async ({ browser }) => {
  const a = await newDraft("resume");
  const f = await bigJpeg("resume.jpg", 30);
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${a}`);
  // Parts are slowed so the page can be lost part-way, on a local emulator that would otherwise finish at once.
  await page.route("**/*partNumber*", async (route) => {
    await new Promise((res) => setTimeout(res, 1500));
    await route.continue().catch(() => {});
  });
  const firstPart = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("partNumber") && r.ok(), { timeout: 60_000 });
  await choose(page, f);
  await firstPart;
  await page.reload();
  await page.unroute("**/*partNumber*");
  expect((await photoRow(a))[0].s3_upload_id).toBeTruthy();
  const again: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("partNumber")) again.push(new URL(r.url()).searchParams.get("partNumber")!);
  });
  await choose(page, f);
  await ready(page, "resume.jpg");
  const [r] = await photoRow(a);
  expect(sha(await getBytes(r.storage_path_original))).toBe(sha(fs.readFileSync(f)));
  const total = Math.ceil(fs.statSync(f).size / (8 * 1024 * 1024));
  expect(again.length).toBeLessThan(total);
  expect(await openUploads(`albums/${a}/`)).toBe(0);
  await page.context().close();
});

test("S6: cancel mid-upload leaves no row, no parts and no object", async ({ browser }) => {
  const a = await newDraft("cancel");
  const f = await bigJpeg("cancel.jpg", 30);
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${a}`);
  await page.route("**/*partNumber*", async (route) => {
    await new Promise((res) => setTimeout(res, 1500));
    await route.continue().catch(() => {});
  });
  await choose(page, f);
  await expect(row(page, "cancel.jpg")).toHaveAttribute("data-state", "uploading", { timeout: 60_000 });
  await row(page, "cancel.jpg").getByTestId("album-upload-cancel").click();
  await expect(row(page, "cancel.jpg")).toHaveAttribute("data-state", "canceled");
  await expect.poll(async () => (await photoRow(a)).length, { timeout: 30_000 }).toBe(0);
  await expect.poll(() => openUploads(`albums/${a}/`), { timeout: 30_000 }).toBe(0);
  expect(((await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `albums/${a}/` }))).Contents ?? []).length).toBe(0);
  await page.context().close();
});

test("S7: admin access removed during the upload: stops with a clear message, no more URLs", async ({ browser }) => {
  const a = await newDraft("revoke");
  const f = await bigJpeg("revoke.jpg", 60);
  const page = await newLoggedIn(browser, "admin", `/admin/albums/${a}`);
  await page.route("**/*partNumber*", async (route) => {
    await new Promise((res) => setTimeout(res, 1000));
    await route.continue().catch(() => {});
  });
  await choose(page, f);
  await expect(row(page, "revoke.jpg")).toHaveAttribute("data-state", "uploading", { timeout: 60_000 });
  const id = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === USERS.admin.email)!.id;
  await db.from("profiles").update({ role: "customer" }).eq("id", id);
  // Either the upload is refused (row failed) or a refresh replaces the page with the permission message. Both are correct.
  await expect(row(page, "revoke.jpg").and(page.locator('[data-state="failed"]')).or(page.getByRole("heading", { name: "لا تملك صلاحية فتح هذه الصفحة" }))).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  await db.from("profiles").update({ role: "admin" }).eq("id", id);
  const [r] = await photoRow(a);
  expect(r.upload_status).toBe("uploading");
  await page.context().close();
});

test("S8: a Supabase photo and an S3 photo side by side both serve, each from its own store", async () => {
  const id = randomUUID();
  const key = `albums/${album}/${id}`;
  const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 10, b: 10 } } }).webp().toBuffer();
  for (const v of ["thumb", "display"]) await db.storage.from("album-media").upload(`${key}/${v}.webp`, img, { contentType: "image/webp" });
  await db.storage.from("album-media").upload(`${key}/original.jpg`, await sharp(img).jpeg().toBuffer(), { contentType: "image/jpeg" });
  await db.from("album_photos").insert({ id, album_id: album, storage_path_original: `${key}/original.jpg`, mime: "image/jpeg", bytes: 10, upload_status: "ready", is_published: true, variants: { thumb: `${key}/thumb.webp`, display: `${key}/display.webp` } });
  const r = await fetch(`${BASE}/p/${id}/thumb`);
  expect(r.status).toBe(200);
  expect(sha(Buffer.from(await r.arrayBuffer()))).toBe(sha(img));
  expect((await fetch(`${BASE}/p/${photo.id}/thumb`)).status).toBe(200);
  expect(await exists(`${key}/thumb.webp`)).toBe(false);
});

const migrate = (args: string[]) => {
  const env = { ...process.env, MIGRATE_TARGET: "local", ENV_FILE: ".env.local" };
  try {
    return { code: 0, out: execFileSync("node", ["scripts/migrate-album-media-to-s3.mjs", ...args, "--album", album], { env, encoding: "utf8" }) };
  } catch (e) {
    const x = e as { status: number; stdout: string };
    return { code: x.status, out: x.stdout };
  }
};

test("S9: migration script: dry run changes nothing; copy verifies, keeps the source; switch serves from S3; a rerun copies nothing; a different file at the destination is never overwritten", async () => {
  const man = path.join(TMP, "manifest.jsonl");
  const before = (await photoRow(album)).find((p) => p.storage_provider === "supabase")!;
  const dry = migrate(["--manifest", man]);
  expect(dry.code).toBe(0);
  expect(JSON.parse(dry.out).mode).toBe("dry-run");
  expect(fs.existsSync(man)).toBe(false);
  expect(await exists(before.variants.thumb)).toBe(false);

  // Destination holds a different file for one variant: that photo must stop, not overwrite.
  const foreign = randomBytes(100);
  await s3.send(new PutObjectCommand({ Bucket, Key: before.variants.display, Body: foreign }));
  const conflict = JSON.parse(migrate(["--manifest", man, "--copy", "--switch"]).out);
  expect(conflict.failed).toBeGreaterThanOrEqual(1);
  expect(sha(await getBytes(before.variants.display))).toBe(sha(foreign));
  expect((await photoRow(album)).find((p) => p.id === before.id)!.storage_provider).toBe("supabase");
  await s3.send(new DeleteObjectCommand({ Bucket, Key: before.variants.display }));

  const run = JSON.parse(migrate(["--manifest", man, "--copy", "--switch"]).out);
  expect(run.failed).toBe(0);
  expect((await photoRow(album)).find((p) => p.id === before.id)!.storage_provider).toBe("s3");
  expect(await exists(before.storage_path_original)).toBe(true);
  // The source is untouched.
  expect((await db.storage.from("album-media").download(before.variants.thumb)).error).toBeNull();
  expect((await fetch(`${BASE}/p/${before.id}/thumb`)).status).toBe(200);

  const again = JSON.parse(migrate(["--manifest", man, "--copy", "--switch"]).out);
  expect(again.copied).toBe(0);
  expect(again.switched).toBe(0);
  await db.storage.from("album-media").remove([before.storage_path_original, before.variants.thumb, before.variants.display]);
});

test("S10: admin order and cover still work; trash then purge removes the S3 objects through the queue; a store failure retries", async ({ browser }) => {
  const page = await newLoggedIn(browser, "owner", `/admin/albums/${album}?view=order`);
  await expect(page.locator("body")).not.toContainText("تعذّر");
  await page.context().close();
  const photos = await photoRow(album);
  const { error } = await db.from("photo_albums").update({ cover_photo_id: photo.id }).eq("id", album);
  expect(error).toBeNull();
  const keys = photos.flatMap((p) => [p.storage_path_original, p.variants.thumb, p.variants.display]);
  for (const k of keys) expect(await exists(k)).toBe(true);
  await db.from("photo_albums").update({ cover_photo_id: null, deleted_at: new Date().toISOString(), is_published: false }).eq("id", album);
  await db.from("album_photos").delete().eq("album_id", album);
  expect(psql(`select count(*) from private.storage_cleanup_queue where provider='s3' and done_at is null and path like 'albums/${album}/%'`).trim()).toBe(String(keys.length));

  const c = process.env.S3_TEST_CONTAINER;
  if (c) {
    execFileSync("docker", ["pause", c]);
    try {
      await runJobs();
    } finally {
      execFileSync("docker", ["unpause", c]);
    }
    expect(Number(psql(`select count(*) from private.storage_cleanup_queue where provider='s3' and done_at is not null and path like 'albums/${album}/%'`).trim())).toBe(0);
    psql(`update private.storage_cleanup_queue set next_attempt_at=now(), claimed_at=null where provider='s3' and path like 'albums/${album}/%'`);
  }
  expect((await runJobs()).status).toBe(200);
  await expect.poll(async () => (await Promise.all(keys.map(exists))).filter(Boolean).length, { timeout: 60_000 }).toBe(0);
});
