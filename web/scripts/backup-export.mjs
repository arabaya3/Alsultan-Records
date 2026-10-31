#!/usr/bin/env node
/**
 * Independent, resumable export of everything the site needs, to a LOCAL folder the owner controls.
 *   node scripts/backup-export.mjs --target staging|local --out <dir> [--tables-only] [--concurrency 4]
 *
 * Writes into <dir>:
 *   data/<table>.json        every public content/business table, paginated (1000 rows/request), streamed to disk
 *   auth/users.json          auth users via the Admin API (ids, emails, metadata — NOT password hashes)
 *   storage/<bucket>/<path>  ALL objects of ALL buckets — album-media originals + variants, site-media, private
 *                            media, backups — streamed to disk while hashing (never held in memory as a whole)
 *   promo-files.json         list (+ sha256) of the self-hosted promo files shipped in web/public/promo
 *   manifest.json            counts, bytes, sha256 per file, status complete|partial, error list
 *
 * Resumable: re-running with the same --out re-downloads only objects that are missing locally, whose local
 * sha256 no longer matches the previous manifest, or whose remote size/etag changed. Tables are re-exported
 * every run (small). Interrupted runs leave manifest status "partial"; just run again.
 *
 * Needs the SECRET key of the source project (web/.env.staging.app.local or .env.local): run it on the
 * owner's machine only. Read-only against the source. Never prints secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const target = opt("--target");
const OUT = opt("--out") && path.resolve(opt("--out"));
const CONC = Math.max(1, Math.min(8, Number(opt("--concurrency") ?? 4)));
const TABLES_ONLY = argv.includes("--tables-only");
if (!["local", "staging"].includes(target) || !OUT) { console.error("usage: backup-export.mjs --target staging|local --out <dir>"); process.exit(2); }

/** FK-friendly order (parents first). Restore runs in replica mode, so cycles (cover photo ids) are fine. */
export const EXPORT_TABLES = [
  "business_settings", "app_settings", "service_categories", "profiles", "customers", "staff_members",
  "media_assets", "services", "booking_requests", "booking_stage_history", "events", "deliverables",
  "deliverable_revisions", "video_comments", "album_selections", "album_selection_items",
  "album_selection_snapshots", "quotes", "quote_items", "contracts", "contract_versions", "payments",
  "expenses", "event_staff_assignments", "equipment", "equipment_assignments", "equipment_maintenance",
  "support_requests", "support_messages", "reviews", "notifications", "audit_events", "backup_runs",
  // gallery + CMS (0013–0018)
  "video_categories", "showcase_videos", "showcase_video_categories", "album_categories", "photo_albums", "album_photos",
  "import_items", "brand_assets", "site_sections", "nav_items", "slug_redirects", "service_links", "process_steps",
  "offers", "offer_items", "announcements",
  // reels + Facebook queue (0027–0031); the Page token lives in Vault and is never exported
  "reel_videos", "meta_page_connection", "facebook_reel_posts",
];

const parse = (p) => Object.fromEntries(fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const env = parse(path.resolve(WEB, target === "local" ? ".env.local" : ".env.staging.app.local"));
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const host = new URL(URL_).hostname;
if (target === "local" && !["127.0.0.1", "localhost"].includes(host)) throw new Error("local target must be the local stack");
if (target === "staging" && host !== "dyuixzxmmeiypvawzmty.supabase.co") throw new Error("staging target must be dyuixzxmmeiypvawzmty");
const KEY = env.SUPABASE_SECRET_KEY;
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

const started = Date.now();
const errors = [];
const prevManifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")); } catch { return null; } })();
const prevFiles = new Map((prevManifest?.files ?? []).map((f) => [f.path, f]));
const files = [];
const rel = (p) => path.relative(OUT, p).split(path.sep).join("/");
fs.mkdirSync(OUT, { recursive: true });

async function sha256File(p) {
  const h = createHash("sha256");
  await pipeline(fs.createReadStream(p), h);
  return h.digest("hex");
}

function writeManifest(status) {
  const by = (pref) => files.filter((f) => f.path.startsWith(pref));
  const sum = (arr) => arr.reduce((n, f) => n + f.bytes, 0);
  const buckets = {};
  for (const f of by("storage/")) {
    const b = f.path.split("/")[1];
    buckets[b] ??= { objects: 0, bytes: 0 };
    buckets[b].objects++;
    buckets[b].bytes += f.bytes;
  }
  const manifest = {
    format: "sultan-records-export/1",
    created_at: new Date(started).toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    source: { target, supabase_host: host },
    status,
    tables,
    storage: buckets,
    totals: { files: files.length, bytes: sum(files), storage_objects: by("storage/").length, storage_bytes: sum(by("storage/")) },
    errors,
    files,
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
  return manifest;
}

// ------------------------------------------------------------------ tables
const tables = {};
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });
for (const t of EXPORT_TABLES) {
  const file = path.join(OUT, "data", `${t}.json`);
  const tmp = `${file}.part`;
  const ws = fs.createWriteStream(tmp);
  let rows = 0;
  let orderCol = "id";
  try {
    ws.write("[");
    for (let from = 0; ; from += 1000) {
      let r = await sb.from(t).select("*").order(orderCol).range(from, from + 999);
      if (r.error && orderCol && from === 0 && /column|order/i.test(r.error.message)) { orderCol = null; r = await sb.from(t).select("*").range(from, from + 999); }
      if (r.error) throw new Error(r.error.message);
      for (const row of r.data) ws.write((rows++ ? ",\n" : "\n") + JSON.stringify(row));
      if (r.data.length < 1000) break;
      if (!orderCol) throw new Error("table larger than 1000 rows without an id column");
    }
    ws.write("\n]\n");
    await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
    fs.renameSync(tmp, file);
    const st = fs.statSync(file);
    const sha = await sha256File(file);
    tables[t] = { rows, bytes: st.size, sha256: sha };
    files.push({ path: rel(file), bytes: st.size, sha256: sha });
  } catch (e) {
    ws.destroy();
    fs.rmSync(tmp, { force: true });
    const msg = String(e.message ?? e);
    if (/does not exist|schema cache|Could not find/i.test(msg)) tables[t] = { skipped: "table not present in source" };
    else { tables[t] = { error: msg }; errors.push({ what: `table ${t}`, error: msg }); }
  }
}
console.log(`tables: ${Object.values(tables).filter((x) => x.rows !== undefined).length} exported, ${Object.values(tables).reduce((n, x) => n + (x.rows ?? 0), 0)} rows`);

// auth users (no password hashes are available through the API)
try {
  const users = [];
  for (let page = 1; ; page++) {
    const r = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (r.error) throw r.error;
    users.push(...r.data.users.map((u) => ({ id: u.id, email: u.email, phone: u.phone, created_at: u.created_at, app_metadata: u.app_metadata, user_metadata: u.user_metadata })));
    if (r.data.users.length < 1000) break;
  }
  const file = path.join(OUT, "auth", "users.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(users, null, 1) + "\n");
  files.push({ path: rel(file), bytes: fs.statSync(file).size, sha256: await sha256File(file) });
  tables["auth.users"] = { rows: users.length, note: "ids/emails/metadata only — passwords and MFA secrets are not exportable via the API" };
} catch (e) { errors.push({ what: "auth users", error: String(e.message ?? e) }); }

// promo files shipped with the site (in git; listed for completeness)
{
  const dir = path.join(WEB, "public", "promo");
  const list = [];
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isFile()) list.push({ path: `public/promo/${n}`, bytes: fs.statSync(p).size, sha256: await sha256File(p) });
  }
  fs.writeFileSync(path.join(OUT, "promo-files.json"), JSON.stringify({ note: "self-hosted promo files are in the git repo (web/public/promo); hashes for verification", files: list }, null, 1) + "\n");
}
writeManifest("partial");

// ------------------------------------------------------------------ storage
let downloaded = 0, skipped = 0;
if (!TABLES_ONLY) {
  const { data: buckets, error } = await sb.storage.listBuckets();
  if (error) errors.push({ what: "list buckets", error: error.message });
  const objects = [];
  async function walk(bucket, prefix) {
    for (let offset = 0; ; offset += 1000) {
      const r = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (r.error) { errors.push({ what: `list ${bucket}/${prefix}`, error: r.error.message }); return; }
      for (const o of r.data) {
        const key = prefix ? `${prefix}/${o.name}` : o.name;
        if (o.id === null || !o.metadata) await walk(bucket, key); // folder
        else objects.push({ bucket, key, size: o.metadata.size ?? null, etag: o.metadata.eTag ?? null, mimetype: o.metadata.mimetype ?? null });
      }
      if (r.data.length < 1000) return;
    }
  }
  for (const b of buckets ?? []) await walk(b.name, "");
  fs.writeFileSync(path.join(OUT, "buckets.json"), JSON.stringify((buckets ?? []).map((b) => ({ id: b.id, name: b.name, public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types })), null, 1) + "\n");
  console.log(`storage: ${objects.length} objects in ${(buckets ?? []).length} buckets`);

  const queue = [...objects];
  let lastSave = Date.now();
  async function worker() {
    for (let o = queue.shift(); o; o = queue.shift()) {
      const local = path.join(OUT, "storage", o.bucket, ...o.key.split("/"));
      const relp = rel(local);
      const prev = prevFiles.get(relp);
      try {
        if (prev && fs.existsSync(local) && prev.bytes === o.size && (prev.etag ?? null) === o.etag && fs.statSync(local).size === o.size && (await sha256File(local)) === prev.sha256) {
          files.push(prev);
          skipped++;
          continue;
        }
        fs.mkdirSync(path.dirname(local), { recursive: true });
        const res = await fetch(`${URL_}/storage/v1/object/${encodeURIComponent(o.bucket)}/${o.key.split("/").map(encodeURIComponent).join("/")}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        if (!res.ok || !res.body) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
        const h = createHash("sha256");
        let bytes = 0;
        const tap = new Transform({ transform(chunk, _e, cb) { h.update(chunk); bytes += chunk.length; cb(null, chunk); } });
        const tmp = `${local}.part`;
        await pipeline(Readable.fromWeb(res.body), tap, fs.createWriteStream(tmp));
        fs.renameSync(tmp, local);
        files.push({ path: relp, bytes, sha256: h.digest("hex"), etag: o.etag, content_type: o.mimetype ?? res.headers.get("content-type") });
        downloaded++;
      } catch (e) {
        errors.push({ what: `object ${o.bucket}/${o.key}`, error: String(e.message ?? e) });
      }
      if (Date.now() - lastSave > 15000) { lastSave = Date.now(); writeManifest("partial"); console.log(`  … ${downloaded + skipped}/${objects.length}`); }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
}
files.sort((a, b) => a.path.localeCompare(b.path));
const m = writeManifest(errors.length || TABLES_ONLY ? "partial" : "complete");
console.log(JSON.stringify({ status: m.status, out: OUT, tables: Object.keys(tables).length, storage: m.storage, downloaded, skipped_unchanged: skipped, totals: m.totals, errors: errors.length, duration_s: Math.round(m.duration_ms / 1000) }, null, 1));
if (errors.length) { console.log(errors.slice(0, 10)); process.exit(1); }
