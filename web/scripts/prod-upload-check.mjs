// Production check of the album upload pipeline (docs/album-upload-release.md). Uses the SERVICE key from the
// gitignored .env.staging.app.local (never printed) — no user account is created or used.
//   node scripts/prod-upload-check.mjs <file> [<file> …]
// 1. creates a PRIVATE draft album (is_published = false) and one `uploading` row per file (like reserveAlbumUpload);
// 2. uploads each file with TUS (resumable, 6 MB chunks) to the production storage hostname;
// 3. marks the rows `pending` (like completeAlbumUpload) and waits for the PRODUCTION worker (pg_cron → Vercel
//    /api/jobs/process-photos, incl. RAW decoding on Vercel) to make them ready;
// 4. verifies the stored originals byte-for-byte (sha256) and the display copies (whole frame, ≤ 1600 px);
// 5. deletes everything it created (rows, objects, album) — also on failure.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as tus from "tus-js-client";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.staging.app.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
if (!/dyuixzxmmeiypvawzmty\.supabase\.co/.test(URL_)) throw new Error("not the approved project");
const KEY = env.SUPABASE_SECRET_KEY;
const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const STORAGE = URL_.replace(".supabase.co", ".storage.supabase.co");
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", cr2: "image/x-canon-cr2", cr3: "image/x-canon-cr3", nef: "image/x-nikon-nef", nrw: "image/x-nikon-nrw", arw: "image/x-sony-arw", dng: "image/x-adobe-dng", raf: "image/x-fuji-raf", orf: "image/x-olympus-orf", rw2: "image/x-panasonic-rw2", pef: "image/x-pentax-pef", srw: "image/x-samsung-srw" };
const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: node scripts/prod-upload-check.mjs <file>…");

const album = randomUUID();
const report = [];
const t0 = Date.now();
try {
  const a = await db.from("photo_albums").insert({ id: album, slug: `prod-upload-check-${Date.now().toString(36)}`, title: "اختبار رفع مؤقت (يُحذف تلقائياً)", is_published: false });
  if (a.error) throw new Error(`album: ${a.error.message}`);
  const rows = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const ext = path.extname(f).slice(1).toLowerCase();
    const id = randomUUID();
    const p = `albums/${album}/${id}/original.${ext === "jpeg" ? "jpg" : ext}`;
    const sha = createHash("sha256").update(buf).digest("hex");
    const ins = await db.from("album_photos").insert({ id, album_id: album, storage_path_original: p, mime: MIME[ext], bytes: buf.length, sha256: sha, upload_status: "uploading", sort_order: rows.length * 10 + 10 });
    if (ins.error) throw new Error(`row ${path.basename(f)}: ${ins.error.message}`);
    const tu = Date.now();
    await new Promise((resolve, reject) => {
      const up = new tus.Upload(buf, {
        endpoint: `${STORAGE}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 6000],
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        headers: { authorization: `Bearer ${KEY}`, apikey: KEY, "x-upsert": "false" },
        metadata: { bucketName: "album-media", objectName: p, contentType: MIME[ext], cacheControl: "3600" },
        onError: (e) => reject(new Error(`tus ${path.basename(f)}: ${e.message.slice(0, 300)}`)),
        onSuccess: () => resolve(),
      });
      up.start();
    });
    const uploadMs = Date.now() - tu;
    const done = await db.from("album_photos").update({ upload_status: "pending" }).eq("id", id);
    if (done.error) throw new Error(`pending: ${done.error.message}`);
    rows.push({ id, file: path.basename(f), mb: +(buf.length / 1048576).toFixed(1), sha, uploadMs, queuedAt: Date.now() });
  }
  // Wait for the production worker (cron every minute + 60 s function).
  const deadline = Date.now() + 8 * 60_000;
  for (;;) {
    const { data } = await db.from("album_photos").select("id, upload_status, last_error, width, height, variants, storage_path_original, format").eq("album_id", album);
    for (const r of rows) {
      const d = data.find((x) => x.id === r.id);
      if (d && (d.upload_status === "ready" || d.upload_status === "failed") && !r.final) Object.assign(r, { final: d.upload_status, readyMs: Date.now() - r.queuedAt, error: d.last_error, w: d.width, h: d.height, variants: d.variants, path: d.storage_path_original, format: d.format });
    }
    if (rows.every((r) => r.final) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  for (const r of rows) {
    const out = { file: r.file, mb: r.mb, uploadS: +(r.uploadMs / 1000).toFixed(1), state: r.final ?? "timeout", processS: r.readyMs ? +(r.readyMs / 1000).toFixed(0) : null, format: r.format, dims: r.w ? `${r.w}x${r.h}` : null, error: r.error ?? undefined };
    if (r.final === "ready") {
      const orig = Buffer.from(await (await db.storage.from("album-media").download(r.path)).data.arrayBuffer());
      out.originalSha256Match = createHash("sha256").update(orig).digest("hex") === r.sha;
      const disp = Buffer.from(await (await db.storage.from("album-media").download(r.variants.display)).data.arrayBuffer());
      const m = await sharp(disp).metadata();
      out.display = `${m.width}x${m.height}`;
      out.wholeFrame = Math.abs(m.width / m.height - r.w / r.h) < 0.01;
      out.exifStripped = m.exif === undefined;
    }
    report.push(out);
  }
} finally {
  const { data: ps } = await db.from("album_photos").select("storage_path_original, variants").eq("album_id", album);
  const paths = (ps ?? []).flatMap((p) => [p.storage_path_original, ...Object.values(p.variants ?? {})]);
  if (paths.length) await db.storage.from("album-media").remove(paths);
  await db.from("album_photos").delete().eq("album_id", album);
  await db.from("photo_albums").delete().eq("id", album);
  const left = await db.from("photo_albums").select("id").eq("id", album);
  console.log(JSON.stringify({ cleanedUp: !left.data?.length, totalS: Math.round((Date.now() - t0) / 1000), report }, null, 1));
}
