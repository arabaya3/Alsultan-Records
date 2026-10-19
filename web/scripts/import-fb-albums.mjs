#!/usr/bin/env node
/**
 * Imports the curated Facebook albums (content/facebook-albums.json) into photo_albums/album_photos and keeps
 * a per-file manifest in public.import_items (source='facebook', source_ref=<fbid>).
 *   node scripts/import-fb-albums.mjs --target local|staging [--apply] [--publish]
 *
 * - Source images: web/.cache/fb-import/<fb_album_id>/<fbid>.jpg (downloaded from the studio's own page
 *   through an owner-authorized session; gitignored). Originals are uploaded untouched (watermarks kept)
 *   to the PRIVATE bucket album-media at albums/<album>/<photo>/original.jpg; thumb (480, q76) and display
 *   (1600, q82) WebP variants — the same recipe as src/features/photo-processing/core.ts.
 * - Manifest + resumable: every listed file gets an import_items row (file_name, sha256, bytes, status,
 *   error, photo_id). Rows already `processed` / `skipped_duplicate` are skipped; `failed` / `pending` are
 *   retried. A crash mid-file leaves `pending` (or `uploaded`) and the next run resumes it.
 * - Dedupe: by sha256 inside the album (album_photos.sha256) and by source_url (old imports).
 * - Backfill: photos imported before the manifest existed are matched by source_url and recorded as
 *   `processed` WITHOUT re-uploading; their album_photos.sha256 is filled from the local cache file
 *   (or, if missing locally, from the stored original — a download, never an upload).
 * - Albums are created hidden; --publish publishes albums that have ≥1 ready photo and sets the cover.
 * Dry-run by default. Never prints secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args[args.indexOf("--target") + 1];
const APPLY = args.includes("--apply");
const PUBLISH = args.includes("--publish");
if (!["local", "staging"].includes(target)) throw new Error("--target local|staging");

const parse = (p) => Object.fromEntries(readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const env = parse(resolve(WEB, target === "local" ? ".env.local" : ".env.staging.app.local"));
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (target === "local" && !["127.0.0.1", "localhost"].includes(host)) throw new Error("local target must be the local stack");
if (target === "staging" && host !== "dyuixzxmmeiypvawzmty.supabase.co") throw new Error("staging target must be dyuixzxmmeiypvawzmty");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const BUCKET = "album-media";
const sel = JSON.parse(readFileSync(resolve(WEB, "content/facebook-albums.json"), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const totals = { albumsCreated: 0, albumsKept: 0, photosAdded: 0, backfilled: 0, alreadyProcessed: 0, duplicates: 0, published: 0, failed: 0 };
console.log(`import-fb-albums ${APPLY ? "APPLY" : "DRY RUN"} → ${target} (${host})`);

const manifest = new Map((must(await sb.from("import_items").select("source_ref, status, photo_id").eq("source", "facebook"), "manifest read") ?? []).map((r) => [r.source_ref, r]));
async function record(row) {
  if (!APPLY) return;
  must(await sb.from("import_items").upsert({ source: "facebook", ...row, error: row.error ?? null }, { onConflict: "source,source_ref" }), "manifest write");
}

async function makeVariants(buf) {
  const img = sharp(buf, { failOn: "error" }).rotate();
  const meta = await img.metadata();
  const [thumb, display] = await Promise.all([
    img.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer(),
    img.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
  ]);
  const oriented = (meta.orientation ?? 1) >= 5;
  return { thumb, display, width: oriented ? meta.height : meta.width, height: oriented ? meta.width : meta.height };
}

for (const a of sel.albums) {
  let album = must(await sb.from("photo_albums").select("id, cover_photo_id, is_published, deleted_at").eq("slug", a.slug).maybeSingle(), "album lookup");
  if (album?.deleted_at) { console.log(`- album ${a.slug} is in the trash — skipped`); continue; }
  if (!album) {
    totals.albumsCreated++;
    console.log(`+ album ${a.slug} (${a.photos.length} photos)`);
    if (!APPLY) { totals.photosAdded += a.photos.length; continue; }
    album = must(await sb.from("photo_albums").insert({
      slug: a.slug, title: a.title, description: null, event_date: a.event_date, source_label: a.source_label, source_url: a.source_url,
      rights_note: sel.source.rights, sort_order: sel.albums.indexOf(a) + 1, is_published: false,
    }).select("id, cover_photo_id, is_published").single(), "album insert");
  } else { totals.albumsKept++; console.log(`= album ${a.slug} exists (kept as is)`); }

  const existing = must(await sb.from("album_photos").select("id, source_url, sha256, storage_path_original, deleted_at").eq("album_id", album.id), "photos lookup");
  const bySource = new Map(existing.filter((p) => p.source_url).map((p) => [p.source_url, p]));
  const bySha = new Map(existing.filter((p) => p.sha256 && !p.deleted_at).map((p) => [p.sha256, p]));
  let coverId = null;
  for (const p of a.photos) {
    const file = resolve(WEB, ".cache/fb-import", a.fb_album_id, `${p.fbid}.jpg`);
    const fileName = `${p.fbid}.jpg`;
    const m = manifest.get(p.fbid);
    const known = bySource.get(p.source_url);
    if (m && (m.status === "processed" || m.status === "skipped_duplicate") && (!known || m.photo_id === known.id || m.status === "skipped_duplicate")) {
      totals.alreadyProcessed++;
      if (p.fbid === a.cover_fbid && m.photo_id) coverId = m.photo_id;
      continue;
    }
    try {
      if (known) {
        // Backfill: imported before the manifest existed. Never re-upload.
        let digest = known.sha256;
        let bytes = null;
        if (!digest) {
          let buf;
          if (existsSync(file)) buf = readFileSync(file);
          else {
            const dl = await sb.storage.from(BUCKET).download(known.storage_path_original);
            if (dl.error) throw new Error(`download original: ${dl.error.message}`);
            buf = Buffer.from(await dl.data.arrayBuffer());
          }
          digest = sha(buf);
          bytes = buf.length;
          if (APPLY) must(await sb.from("album_photos").update({ sha256: digest }).eq("id", known.id), "sha backfill");
        }
        await record({ source_ref: p.fbid, album_id: album.id, file_name: fileName, sha256: digest, bytes, status: "processed", photo_id: known.id });
        totals.backfilled++;
        if (p.fbid === a.cover_fbid) coverId = known.id;
        continue;
      }
      if (!existsSync(file)) throw new Error("missing source file in .cache/fb-import");
      const buf = readFileSync(file);
      const digest = sha(buf);
      const dup = bySha.get(digest);
      if (dup) {
        totals.duplicates++;
        await record({ source_ref: p.fbid, album_id: album.id, file_name: fileName, sha256: digest, bytes: buf.length, status: "skipped_duplicate", photo_id: dup.id });
        continue;
      }
      totals.photosAdded++;
      if (!APPLY) continue;
      await record({ source_ref: p.fbid, album_id: album.id, file_name: fileName, sha256: digest, bytes: buf.length, status: "pending" });
      const photoId = randomUUID();
      const base = `albums/${album.id}/${photoId}`;
      const v = await makeVariants(buf);
      const opt = { upsert: true, cacheControl: "31536000" };
      must(await sb.storage.from(BUCKET).upload(`${base}/original.jpg`, buf, { ...opt, contentType: "image/jpeg" }), "upload original");
      await record({ source_ref: p.fbid, album_id: album.id, file_name: fileName, sha256: digest, bytes: buf.length, status: "uploaded" });
      must(await sb.storage.from(BUCKET).upload(`${base}/thumb.webp`, v.thumb, { ...opt, contentType: "image/webp" }), "upload thumb");
      must(await sb.storage.from(BUCKET).upload(`${base}/display.webp`, v.display, { ...opt, contentType: "image/webp" }), "upload display");
      must(await sb.from("album_photos").insert({
        id: photoId, album_id: album.id, storage_path_original: `${base}/original.jpg`,
        variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` },
        width: v.width, height: v.height, bytes: buf.length, mime: "image/jpeg", alt_text: a.title, source_url: p.source_url,
        sha256: digest, sort_order: p.sort_order, is_published: true, upload_status: "ready",
      }), "photo insert");
      await record({ source_ref: p.fbid, album_id: album.id, file_name: fileName, sha256: digest, bytes: buf.length, status: "processed", photo_id: photoId });
      bySha.set(digest, { id: photoId });
      if (p.fbid === a.cover_fbid) coverId = photoId;
    } catch (e) {
      totals.failed++;
      const msg = String(e?.message ?? e).slice(0, 300);
      console.log(`  ! ${p.fbid}: ${msg}`);
      await record({ source_ref: p.fbid, album_id: album.id, file_name: fileName, status: "failed", error: msg }).catch(() => {});
    }
  }
  if (APPLY && PUBLISH) {
    if (!album.cover_photo_id && coverId) must(await sb.from("photo_albums").update({ cover_photo_id: coverId }).eq("id", album.id), "set cover");
    if (!album.is_published) { must(await sb.from("photo_albums").update({ is_published: true }).eq("id", album.id), "publish"); totals.published++; }
  }
}
console.log(`summary (${APPLY ? "applied" : "dry run"}): ${JSON.stringify(totals)}`);
if (totals.failed) process.exit(1);
