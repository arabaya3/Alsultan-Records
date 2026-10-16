#!/usr/bin/env node
/**
 * Imports the curated Facebook albums (content/facebook-albums.json) into photo_albums/album_photos.
 *   node scripts/import-fb-albums.mjs --target local|staging [--apply] [--publish]
 *
 * - Source images: web/.cache/fb-import/<fb_album_id>/<fbid>.jpg (downloaded from the studio's own page
 *   through an owner-authorized session; gitignored). Originals are uploaded untouched (watermarks kept)
 *   to the PRIVATE bucket album-media at albums/<album>/<photo>/original.jpg; thumb (480, q76) and display
 *   (1600, q82) WebP variants are generated exactly like the admin uploader.
 * - Idempotent: albums matched by slug, photos by source_url. Existing albums keep any admin edits
 *   (title, description, publish state, order); only missing photos are added. Re-runs add nothing.
 * - Albums are created hidden; --publish publishes albums that have ≥1 ready photo and sets the cover
 *   (only if the album has no cover yet).
 * Dry-run by default. Never prints secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
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

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const totals = { albumsCreated: 0, albumsKept: 0, photosAdded: 0, photosKept: 0, published: 0, failed: 0 };
console.log(`import-fb-albums ${APPLY ? "APPLY" : "DRY RUN"} → ${target} (${host})`);

for (const a of sel.albums) {
  let album = must(await sb.from("photo_albums").select("id, cover_photo_id, is_published").eq("slug", a.slug).maybeSingle(), "album lookup");
  if (!album) {
    totals.albumsCreated++;
    console.log(`+ album ${a.slug} (${a.photos.length} photos)`);
    if (!APPLY) continue;
    album = must(await sb.from("photo_albums").insert({
      slug: a.slug, title: a.title, description: null, event_date: a.event_date, source_label: a.source_label, source_url: a.source_url,
      rights_note: sel.source.rights, sort_order: sel.albums.indexOf(a) + 1, is_published: false,
    }).select("id, cover_photo_id, is_published").single(), "album insert");
  } else { totals.albumsKept++; console.log(`= album ${a.slug} exists (kept as is)`); }

  const existing = must(await sb.from("album_photos").select("id, source_url").eq("album_id", album.id), "photos lookup");
  const have = new Map(existing.map((p) => [p.source_url, p.id]));
  let coverId = null;
  for (const p of a.photos) {
    if (have.has(p.source_url)) { totals.photosKept++; if (p.fbid === a.cover_fbid) coverId = have.get(p.source_url); continue; }
    totals.photosAdded++;
    if (!APPLY) continue;
    const file = resolve(WEB, ".cache/fb-import", a.fb_album_id, `${p.fbid}.jpg`);
    if (!existsSync(file)) { totals.failed++; console.log(`  ! missing source file for ${p.fbid}`); continue; }
    const buf = readFileSync(file);
    const photoId = randomUUID();
    const base = `albums/${album.id}/${photoId}`;
    try {
      const img = sharp(buf, { failOn: "error" }).rotate();
      const meta = await img.metadata();
      const [thumb, display] = await Promise.all([
        img.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer(),
        img.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
      ]);
      const opt = { upsert: false, cacheControl: "31536000" };
      must(await sb.storage.from(BUCKET).upload(`${base}/original.jpg`, buf, { ...opt, contentType: "image/jpeg" }), "upload original");
      must(await sb.storage.from(BUCKET).upload(`${base}/thumb.webp`, thumb, { ...opt, contentType: "image/webp" }), "upload thumb");
      must(await sb.storage.from(BUCKET).upload(`${base}/display.webp`, display, { ...opt, contentType: "image/webp" }), "upload display");
      const oriented = (meta.orientation ?? 1) >= 5;
      must(await sb.from("album_photos").insert({
        id: photoId, album_id: album.id, storage_path_original: `${base}/original.jpg`,
        variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` },
        width: oriented ? meta.height : meta.width, height: oriented ? meta.width : meta.height,
        bytes: buf.length, mime: "image/jpeg", alt_text: a.title, source_url: p.source_url,
        sort_order: p.sort_order, is_published: true, upload_status: "ready",
      }), "photo insert");
      if (p.fbid === a.cover_fbid) coverId = photoId;
    } catch (e) { totals.failed++; console.log(`  ! ${p.fbid}: ${String(e.message ?? e).slice(0, 120)}`); }
  }
  if (APPLY && PUBLISH) {
    if (!album.cover_photo_id && coverId) must(await sb.from("photo_albums").update({ cover_photo_id: coverId }).eq("id", album.id), "set cover");
    if (!album.is_published) { must(await sb.from("photo_albums").update({ is_published: true }).eq("id", album.id), "publish"); totals.published++; }
  }
}
console.log(`summary (${APPLY ? "applied" : "dry run"}): ${JSON.stringify(totals)}`);
if (totals.failed) process.exit(1);
