#!/usr/bin/env node
/**
 * Proves the photo archive does not depend on Facebook.
 *   node scripts/verify-fb-independence.mjs --target local|staging [--site <url>] [--sample <n>|--all] [--out <file>]
 *
 * Checks (read-only; secret key for DB/storage reads, anonymous HTTP for the site):
 *   1. every PUBLISHED photo of every PUBLISHED album has its thumb + display variants in our own bucket
 *      `album-media` (and its original), with non-zero size;
 *   2. GET <site>/p/<id>/display returns 200 image/* from the live site (sample on local, all on staging
 *      by default), never a redirect;
 *   3. NO stored value anywhere in the content tables or storage paths references Facebook's CDN
 *      (fbcdn.net / scontent*). `source_url` pointing at facebook.com photo PAGES is provenance metadata
 *      (shown as a credit link, never loaded as an image) and is reported separately.
 * Writes docs/fb-independence-report.json (default). Exit 1 if any check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const target = opt("--target");
if (!["local", "staging"].includes(target)) { console.error("--target local|staging"); process.exit(2); }
const parse = (p) => Object.fromEntries(fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const env = parse(path.resolve(WEB, target === "local" ? ".env.local" : ".env.staging.app.local"));
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;
if (target === "local" && !["127.0.0.1", "localhost"].includes(host)) throw new Error("local target must be the local stack");
if (target === "staging" && host !== "dyuixzxmmeiypvawzmty.supabase.co") throw new Error("staging target must be dyuixzxmmeiypvawzmty");
const SITE = (opt("--site") ?? (target === "staging" ? "https://sultan-records.vercel.app" : "http://127.0.0.1:3600")).replace(/\/$/, "");
const ALL = argv.includes("--all") || (target === "staging" && !opt("--sample"));
const SAMPLE = Number(opt("--sample") ?? 12);
const OUT = path.resolve(opt("--out") ?? path.join(WEB, "..", "docs", "fb-independence-report.json"));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const BUCKET = "album-media";
const CDN = /fbcdn\.net|(^|[/.])scontent[\w.-]*\.(xx\.)?fbcdn|scontent[-.]/i;
const FB_PAGE = /^https:\/\/(www\.|m\.)?facebook\.com\//i;

const started = Date.now();
const failures = [];
const fail = (what, detail) => failures.push({ what, ...detail });

async function all(table, cols = "*") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from(table).select(cols).range(from, from + 999);
    if (r.error) return { missing: true, error: r.error.message, rows: out };
    out.push(...r.data);
    if (r.data.length < 1000) return { rows: out };
  }
}

// ---- 1. published photos have our own variants
const albums = (await all("photo_albums")).rows;
const photos = (await all("album_photos")).rows;
const live = (x) => !x.deleted_at && !x.archived_at;
const pubAlbums = albums.filter((a) => a.is_published && live(a));
const pubAlbumIds = new Set(pubAlbums.map((a) => a.id));
const pubPhotos = photos.filter((p) => pubAlbumIds.has(p.album_id) && p.is_published && p.upload_status === "ready" && !p.deleted_at);

const sizes = new Map();
const folders = new Set(pubPhotos.map((p) => p.storage_path_original.slice(0, p.storage_path_original.lastIndexOf("/"))));
for (const f of folders) {
  const r = await sb.storage.from(BUCKET).list(f, { limit: 100 });
  if (r.error) { fail("storage list", { folder: f, error: r.error.message }); continue; }
  for (const o of r.data) sizes.set(`${f}/${o.name}`, o.metadata?.size ?? 0);
}
let variantsOk = 0;
for (const p of pubPhotos) {
  const v = p.variants ?? {};
  const need = { original: p.storage_path_original, thumb: v.thumb, display: v.display };
  const missing = Object.entries(need).filter(([, k]) => !k || !(sizes.get(k) > 0)).map(([n]) => n);
  if (missing.length) fail("variant missing in album-media", { photo_id: p.id, missing });
  else variantsOk++;
}

// ---- 2. the live site serves them
const pick = ALL ? pubPhotos : [...pubPhotos].sort((a, b) => a.id.localeCompare(b.id)).filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / SAMPLE)) === 0).slice(0, SAMPLE);
let httpOk = 0;
const httpFail = [];
const queue = [...pick];
async function worker() {
  for (let p = queue.shift(); p; p = queue.shift()) {
    try {
      const r = await fetch(`${SITE}/p/${p.id}/display`, { redirect: "manual", headers: { "user-agent": "fb-independence-check" } });
      const ct = r.headers.get("content-type") ?? "";
      const len = (await r.arrayBuffer()).byteLength;
      if (r.status === 200 && /^image\//.test(ct) && len > 0) httpOk++;
      else httpFail.push({ photo_id: p.id, status: r.status, content_type: ct, location: r.headers.get("location") });
    } catch (e) { httpFail.push({ photo_id: p.id, error: String(e.message ?? e) }); }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
for (const f of httpFail) fail("site did not serve /p/<id>/display", f);

// ---- 3. no Facebook CDN references anywhere stored
const TABLES = [
  "business_settings", "services", "showcase_videos", "video_categories", "photo_albums", "album_photos", "album_categories",
  "import_items", "media_assets", "brand_assets", "site_sections", "nav_items", "slug_redirects", "service_links", "process_steps",
  "offers", "offer_items", "announcements", "reviews", "events", "deliverables",
];
const cdnHits = [];
const provenance = { album_photos_source_url_facebook_pages: 0, photo_albums_source_url_facebook_pages: 0, other: [] };
const scanned = {};
for (const t of TABLES) {
  const r = t === "photo_albums" ? { rows: albums } : t === "album_photos" ? { rows: photos } : await all(t);
  if (r.missing) { scanned[t] = `not scanned (${r.error})`; continue; }
  scanned[t] = r.rows.length;
  for (const row of r.rows) {
    for (const [col, val] of Object.entries(row)) {
      if (val == null) continue;
      const s = typeof val === "string" ? val : JSON.stringify(val);
      if (CDN.test(s)) cdnHits.push({ table: t, id: row.id ?? row.key ?? null, column: col, value: s.slice(0, 160) });
      else if (col === "source_url" && FB_PAGE.test(s)) {
        if (t === "album_photos") provenance.album_photos_source_url_facebook_pages++;
        else if (t === "photo_albums") provenance.photo_albums_source_url_facebook_pages++;
        else provenance.other.push({ table: t, id: row.id });
      }
    }
  }
}
// storage object names in album-media (every folder of every photo, not only published)
let objectsScanned = 0;
for (const p of photos) {
  for (const k of [p.storage_path_original, ...Object.values(p.variants ?? {})]) {
    objectsScanned++;
    if (typeof k === "string" && CDN.test(k)) cdnHits.push({ table: "storage:album-media", id: p.id, column: "path", value: k });
  }
}
for (const h of cdnHits) fail("Facebook CDN reference stored", h);

const report = {
  generated_at: new Date().toISOString(),
  target, supabase_host: host, site: SITE,
  albums: { total: albums.length, published: pubAlbums.length },
  published_photos: pubPhotos.length,
  variants_in_album_media: { ok: variantsOk, missing: pubPhotos.length - variantsOk },
  http_display: { checked: pick.length, mode: ALL ? "all" : `sample of ${pick.length}`, ok: httpOk, failed: httpFail.length },
  fbcdn_references: cdnHits.length,
  provenance_links: provenance,
  tables_scanned: scanned,
  storage_paths_scanned: objectsScanned,
  failures,
  verdict: failures.length ? "FAIL" : "PASS — every published photo is served from our own storage; no Facebook CDN URL is stored",
  duration_ms: Date.now() - started,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ ...report, failures: failures.slice(0, 10), tables_scanned: undefined }, null, 1));
console.log(`report → ${path.relative(process.cwd(), OUT)}`);
if (failures.length) process.exit(1);
