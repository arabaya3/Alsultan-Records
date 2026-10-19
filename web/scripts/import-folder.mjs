#!/usr/bin/env node
/**
 * Imports original photo files from a local folder (owner exports, camera originals) into an EXISTING album.
 *   node scripts/import-folder.mjs --target local|staging --album <slug> --dir <path> [--apply] [--publish]
 *
 * - Files: .jpg/.jpeg/.png/.webp/.avif (checked by content with sharp, not just the extension), ≤ 25 MB,
 *   in the folder and its sub-folders, imported in path order.
 * - Originals are uploaded untouched to the PRIVATE bucket album-media; thumb/display WebP variants use the
 *   same recipe as the server worker (480/q76, 1600/q82).
 * - Manifest: one public.import_items row per file (source='folder', source_ref='<album-slug>/<relative path>',
 *   file_name, sha256, bytes, status, error, photo_id). Resumable: processed/skipped files are skipped on
 *   re-run; failed/pending ones are retried.
 * - Dedupe by sha256: identical content already in the album → skipped_duplicate. Same content in ANOTHER
 *   album → imported, with a warning naming that album.
 * - Never publishes unless --publish (then the new photos are visible and the album is published if it has
 *   ≥ 1 ready photo; the cover is set only if the album has none).
 * Dry-run by default. Never prints secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const target = opt("--target");
const slug = opt("--album");
const dir = opt("--dir");
const APPLY = argv.includes("--apply");
const PUBLISH = argv.includes("--publish");
if (!["local", "staging"].includes(target) || !slug || !dir) {
  console.error("usage: import-folder.mjs --target local|staging --album <slug> --dir <path> [--apply] [--publish]");
  process.exit(2);
}
const MAX = 25 * 1024 ** 2;
const EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif" };
const FORMAT_MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heif: "image/avif", avif: "image/avif" };
const BUCKET = "album-media";

const parse = (p) => Object.fromEntries(fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const env = parse(path.resolve(WEB, target === "local" ? ".env.local" : ".env.staging.app.local"));
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (target === "local" && !["127.0.0.1", "localhost"].includes(host)) throw new Error("local target must be the local stack");
if (target === "staging" && host !== "dyuixzxmmeiypvawzmty.supabase.co") throw new Error("staging target must be dyuixzxmmeiypvawzmty");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const root = path.resolve(dir);
if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`--dir ${root} is not a folder`);
const files = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && EXT[path.extname(d.name).toLowerCase()])
  .map((d) => path.join(d.parentPath ?? d.path, d.name))
  .sort();
console.log(`import-folder ${APPLY ? "APPLY" : "DRY RUN"} → ${target} (${host}) album=${slug} files=${files.length}`);

const album = must(await sb.from("photo_albums").select("id, title, cover_photo_id, is_published, deleted_at, archived_at").eq("slug", slug).maybeSingle(), "album lookup");
if (!album) throw new Error(`album ${slug} not found — create it in /admin/albums first`);
if (album.deleted_at) throw new Error(`album ${slug} is in the trash`);
const existing = must(await sb.from("album_photos").select("id, sha256, sort_order").eq("album_id", album.id).is("deleted_at", null), "photos");
const inAlbum = new Map(existing.filter((p) => p.sha256).map((p) => [p.sha256, p.id]));
let sort = Math.max(0, ...existing.map((p) => p.sort_order ?? 0)) + 10;
const manifest = new Map((must(await sb.from("import_items").select("source_ref, status, photo_id").eq("source", "folder").like("source_ref", `${slug}/%`), "manifest") ?? []).map((r) => [r.source_ref, r]));
const record = async (row) => { if (APPLY) must(await sb.from("import_items").upsert({ source: "folder", album_id: album.id, error: null, ...row }, { onConflict: "source,source_ref" }), "manifest write"); };

const totals = { added: 0, alreadyDone: 0, duplicates: 0, warnedOtherAlbum: 0, failed: 0, bytes: 0 };
let firstNew = null;
for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  const ref = `${slug}/${rel}`.slice(0, 500);
  const name = path.basename(file).slice(0, 300);
  const m = manifest.get(ref);
  if (m && (m.status === "processed" || m.status === "skipped_duplicate")) { totals.alreadyDone++; continue; }
  try {
    const size = fs.statSync(file).size;
    if (!size || size > MAX) throw new Error(`size ${size} bytes is outside 1..25 MB`);
    const buf = fs.readFileSync(file);
    const digest = sha(buf);
    const meta = await sharp(buf, { failOn: "error" }).metadata();
    const mime = FORMAT_MIME[meta.format];
    if (!mime) throw new Error(`unsupported content (${meta.format ?? "unknown"})`);
    if (inAlbum.has(digest)) {
      totals.duplicates++;
      await record({ source_ref: ref, file_name: name, sha256: digest, bytes: size, status: "skipped_duplicate", photo_id: inAlbum.get(digest) });
      continue;
    }
    const other = must(await sb.from("album_photos").select("album_id, photo_albums!album_photos_album_id_fkey(title)").eq("sha256", digest).is("deleted_at", null).neq("album_id", album.id).limit(1), "dup lookup");
    if (other?.length) { totals.warnedOtherAlbum++; console.log(`  ~ ${rel}: same photo already in album «${other[0].photo_albums.title}» (imported anyway)`); }
    totals.added++;
    totals.bytes += size;
    if (!APPLY) continue;
    await record({ source_ref: ref, file_name: name, sha256: digest, bytes: size, status: "pending" });
    const photoId = randomUUID();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" }[mime];
    const base = `albums/${album.id}/${photoId}`;
    const img = sharp(buf, { failOn: "error" }).rotate();
    const [thumb, display] = await Promise.all([
      img.clone().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer(),
      img.clone().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    ]);
    const up = { upsert: true, cacheControl: "31536000" };
    must(await sb.storage.from(BUCKET).upload(`${base}/original.${ext}`, buf, { ...up, contentType: mime }), "upload original");
    await record({ source_ref: ref, file_name: name, sha256: digest, bytes: size, status: "uploaded" });
    must(await sb.storage.from(BUCKET).upload(`${base}/thumb.webp`, thumb, { ...up, contentType: "image/webp" }), "upload thumb");
    must(await sb.storage.from(BUCKET).upload(`${base}/display.webp`, display, { ...up, contentType: "image/webp" }), "upload display");
    const oriented = (meta.orientation ?? 1) >= 5;
    must(await sb.from("album_photos").insert({
      id: photoId, album_id: album.id, storage_path_original: `${base}/original.${ext}`,
      variants: { thumb: `${base}/thumb.webp`, display: `${base}/display.webp` },
      width: oriented ? meta.height : meta.width, height: oriented ? meta.width : meta.height,
      bytes: size, mime, sha256: digest, alt_text: album.title, sort_order: sort, is_published: PUBLISH, upload_status: "ready",
    }), "photo insert");
    sort += 10;
    inAlbum.set(digest, photoId);
    firstNew ??= photoId;
    await record({ source_ref: ref, file_name: name, sha256: digest, bytes: size, status: "processed", photo_id: photoId });
    console.log(`  + ${rel}`);
  } catch (e) {
    totals.failed++;
    const msg = String(e?.message ?? e).slice(0, 300);
    console.log(`  ! ${rel}: ${msg}`);
    await record({ source_ref: ref, file_name: name, status: "failed", error: msg }).catch(() => {});
  }
}
if (APPLY && PUBLISH && !album.archived_at) {
  if (!album.cover_photo_id && firstNew) must(await sb.from("photo_albums").update({ cover_photo_id: firstNew }).eq("id", album.id), "cover");
  if (!album.is_published) must(await sb.from("photo_albums").update({ is_published: true }).eq("id", album.id), "publish");
}
console.log(`summary (${APPLY ? "applied" : "dry run"}): ${JSON.stringify(totals)}${APPLY && !PUBLISH ? " — new photos are hidden; publish them in /admin/albums" : ""}`);
if (APPLY) console.log("note: the public site caches album pages; changes appear after the next admin save in /admin/albums or cache expiry.");
if (totals.failed) process.exit(1);
