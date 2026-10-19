import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { BASE, db, E } from "./qa-helpers";

/**
 * Server-side photo processing queue (no browser involved). Local stack + a server started with JOBS_SECRET:
 *   JOBS_SECRET=<same value> BASE_URL=http://localhost:3400 npx playwright test photo-pipeline
 * The test reads JOBS_SECRET from the environment or web/.env.local.
 */
test.describe.configure({ mode: "serial" });
const SECRET = process.env.JOBS_SECRET ?? (E as Record<string, string>).JOBS_SECRET ?? "";
const SLUG = "e2e-pipeline";
const BUCKET = "album-media";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const old = () => new Date(Date.now() - 5 * 60_000).toISOString();
let albumId = "";

async function cleanup() {
  const { data: a } = await db.from("photo_albums").select("id").eq("slug", SLUG).maybeSingle();
  if (!a) return;
  const { data: ps } = await db.from("album_photos").select("id").eq("album_id", a.id);
  for (const p of ps ?? []) {
    const base = `albums/${a.id}/${p.id}`;
    await db.storage.from(BUCKET).remove([`${base}/original.jpg`, `${base}/thumb.webp`, `${base}/display.webp`]);
  }
  await db.from("photo_albums").delete().eq("id", a.id);
}
test.beforeAll(async () => {
  await cleanup();
  albumId = (await db.from("photo_albums").insert({ slug: SLUG, title: "اختبار المعالجة" }).select("id").single()).data!.id;
});
test.afterAll(cleanup);

async function pendingPhoto(opts: { corrupt?: boolean; status?: string; attempts?: number; startedAt?: string } = {}) {
  // Unique pixels per fixture: (album_id, sha256) is unique, so identical images would be rejected as duplicates.
  const rnd = () => Math.floor(Math.random() * 256);
  const buf = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: { r: rnd(), g: rnd(), b: rnd() } } }).jpeg().toBuffer();
  const id = randomUUID();
  const path = `albums/${albumId}/${id}/original.jpg`;
  expect((await db.storage.from(BUCKET).upload(path, buf, { contentType: "image/jpeg" })).error).toBeNull();
  const ins = await db.from("album_photos").insert({
    id, album_id: albumId, storage_path_original: path, mime: "image/jpeg", bytes: buf.length,
    sha256: opts.corrupt ? "0".repeat(64) : sha(buf), upload_status: opts.status ?? "pending",
    attempts: opts.attempts ?? 0, processing_started_at: opts.startedAt ?? null, created_at: old(),
  });
  expect(ins.error).toBeNull();
  return id;
}
const run = (secret?: string) => fetch(`${BASE}/api/jobs/process-photos`, { method: "POST", headers: secret ? { "x-jobs-secret": secret } : {} });
const row = async (id: string) => (await db.from("album_photos").select("upload_status, variants, width, height, attempts, last_error").eq("id", id).single()).data!;

test("P1: route rejects missing/wrong secret and GET", async () => {
  expect((await run()).status).toBe(401);
  expect((await run("x".repeat(40))).status).toBe(401);
  expect((await fetch(`${BASE}/api/jobs/process-photos`)).status).toBe(405);
});

test("P2: pending photo is processed without any browser (480/1600 webp, dims, ready)", async () => {
  test.skip(!SECRET, "JOBS_SECRET not configured for this run");
  const id = await pendingPhoto();
  for (let i = 0; i < 5 && (await row(id)).upload_status !== "ready"; i++) expect((await run(SECRET)).status).toBe(200);
  const r = await row(id);
  expect(r).toMatchObject({ upload_status: "ready", width: 2000, height: 1200 });
  const v = r.variants as Record<string, string>;
  const t = await sharp(Buffer.from(await (await db.storage.from(BUCKET).download(v.thumb)).data!.arrayBuffer())).metadata();
  const d = await sharp(Buffer.from(await (await db.storage.from(BUCKET).download(v.display)).data!.arrayBuffer())).metadata();
  expect([t.format, t.width, d.width]).toEqual(["webp", 480, 1600]);
});

test("P3: checksum mismatch fails; stale processing is reclaimed; attempts ≥ 5 are left alone", async () => {
  test.skip(!SECRET, "JOBS_SECRET not configured for this run");
  const bad = await pendingPhoto({ corrupt: true });
  const stale = await pendingPhoto({ status: "processing", attempts: 1, startedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
  const spent = await pendingPhoto({ status: "failed", attempts: 5 });
  for (let i = 0; i < 6; i++) await run(SECRET);
  expect((await row(bad)).upload_status).toBe("failed");
  expect((await row(bad)).last_error).toMatch(/checksum/);
  expect((await row(stale)).upload_status).toBe("ready");
  expect(await row(spent)).toMatchObject({ upload_status: "failed", attempts: 5 });
});
