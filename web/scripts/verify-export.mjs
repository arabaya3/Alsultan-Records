#!/usr/bin/env node
/**
 * Verifies an export (backup-export.mjs) against the isolated restore stack (backup-restore-export.mjs).
 *   node scripts/verify-export.mjs --from <export dir> --target local-isolated [--report <file>]
 * Checks: 1) local files match manifest sha256; 2) row counts per table equal the manifest; 3) every exported
 * storage object exists in the restored stack with the same sha256 (downloaded back); 4) album_photos.sha256
 * equals the sha256 of the exported original; 5) a published photo is served the way /p/<id>/<variant> serves
 * it (anon RLS row → anon path RPC → anon storage read = 200 image/webp) and the original is denied to anon.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { runPsql, stackStatus } from "./backup-lib.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const FROM = path.resolve(opt("--from") ?? "");
if (opt("--target") !== "local-isolated") { console.error("--target local-isolated required"); process.exit(2); }
const REPORT = path.resolve(opt("--report") ?? path.join(WEB, "..", "docs", "backup-export-report.json"));
const st = stackStatus(".cache/export-restore");
if (new URL(st.url).port !== "56321") throw new Error("not the isolated stack");
const manifest = JSON.parse(fs.readFileSync(path.join(FROM, "manifest.json"), "utf8"));
const sb = createClient(st.url, st.secret, { auth: { persistSession: false } });
const anon = createClient(st.url, st.publishable, { auth: { persistSession: false } });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const t0 = Date.now();
const failures = [];

// 1. local integrity
let localOk = 0;
for (const f of manifest.files) {
  const p = path.join(FROM, ...f.path.split("/"));
  if (fs.existsSync(p) && sha(fs.readFileSync(p)) === f.sha256) localOk++; else failures.push({ check: "local file", path: f.path });
}
// 2. counts
const counts = {};
for (const [t, info] of Object.entries(manifest.tables)) {
  if (info.rows === undefined) continue;
  const q = t === "auth.users" ? "select count(*) from auth.users" : `select count(*) from public.${t}`;
  const r = runPsql({ container: "supabase_db_alsultan-export-restore" }, q + ";");
  const n = Number(r.stdout.trim());
  counts[t] = { exported: info.rows, restored: n };
  if (n !== info.rows) failures.push({ check: "row count", table: t, exported: info.rows, restored: n });
}
// 3. storage read-back
const objs = manifest.files.filter((f) => f.path.startsWith("storage/"));
let storageOk = 0;
const q = [...objs];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let f = q.shift(); f; f = q.shift()) {
    const [, bucket, ...rest] = f.path.split("/");
    const r = await sb.storage.from(bucket).download(rest.join("/"));
    if (r.error) { failures.push({ check: "storage object", path: f.path, error: r.error.message }); continue; }
    if (sha(Buffer.from(await r.data.arrayBuffer())) === f.sha256) storageOk++; else failures.push({ check: "storage checksum", path: f.path });
  }
}));
// 4. album_photos.sha256 vs exported originals
const byPath = new Map(objs.map((f) => [f.path.replace(/^storage\/album-media\//, ""), f.sha256]));
const photos = (await sb.from("album_photos").select("id, album_id, sha256, storage_path_original, variants, is_published, upload_status")).data ?? [];
let shaOk = 0, shaMissing = 0;
for (const p of photos) {
  if (!p.sha256) { shaMissing++; continue; }
  if (byPath.get(p.storage_path_original) === p.sha256) shaOk++; else failures.push({ check: "photo sha256 vs original", photo_id: p.id });
}
// 5. public serving path on the restored stack
const serve = { checked: 0, ok: 0, original_denied: 0 };
const { data: visible } = await anon.from("album_photos").select("id").limit(3);
for (const v of visible ?? []) {
  serve.checked++;
  const { data: objPath } = await anon.rpc("album_photo_object_path", { p_photo_id: v.id, p_variant: "display" });
  const res = await fetch(`${st.url}/storage/v1/object/authenticated/album-media/${objPath}`, { headers: { apikey: st.publishable, Authorization: `Bearer ${st.publishable}` } });
  const ct = res.headers.get("content-type") ?? "";
  await res.arrayBuffer();
  if (res.status === 200 && ct.startsWith("image/webp")) serve.ok++; else failures.push({ check: "anon display", photo_id: v.id, status: res.status });
  const orig = photos.find((p) => p.id === v.id)?.storage_path_original;
  const o = await fetch(`${st.url}/storage/v1/object/authenticated/album-media/${orig}`, { headers: { apikey: st.publishable, Authorization: `Bearer ${st.publishable}` } });
  await o.arrayBuffer();
  if (o.status !== 200) serve.original_denied++; else failures.push({ check: "original exposed to anon", photo_id: v.id });
}
if (!serve.checked) failures.push({ check: "anon sees no published photo on restored stack" });

const report = {
  verified_at: new Date().toISOString(), export: path.basename(FROM), export_created_at: manifest.created_at, source: manifest.source,
  export_status: manifest.status, export_totals: manifest.totals, export_duration_ms: manifest.duration_ms,
  local_files_ok: `${localOk}/${manifest.files.length}`, table_counts: counts,
  storage_readback_ok: `${storageOk}/${objs.length}`,
  photo_sha256_matches_original: { ok: shaOk, without_sha256: shaMissing, total: photos.length },
  public_serving: serve, failures, verdict: failures.length ? "FAIL" : "PASS", duration_ms: Date.now() - t0,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify({ ...report, table_counts: undefined }, null, 1));
if (failures.length) process.exit(1);
