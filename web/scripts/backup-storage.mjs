// Storage binaries backup / restore (the in-app backup only writes a manifest).
//
//   Backup every object of every bucket to a folder, with sha256 checksums:
//     node scripts/backup-storage.mjs backup --out DIR [--url U --secret K | --workdir W] [--buckets a,b]
//   Restore a folder into a project and verify every checksum by downloading it back:
//     node scripts/backup-storage.mjs restore-storage --from DIR [--url U --secret K | --workdir W]
//
// Credentials: --url/--secret, or --workdir <dir containing supabase/> (reads `supabase status`),
// or .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY). Non-local URLs are refused unless
// --target-url <same url> --i-understand-remote is passed.
//
// Output layout: DIR/objects/<bucket>/<path> + DIR/storage-checksums.json
//   { generated_at, source, buckets: { name: { public, count, bytes } }, objects: [{ bucket, path, size, mimetype, sha256 }] }
// Exit code is non-zero on any listing/download/upload error or checksum mismatch.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { assertTargetAllowed, loadEnvFile, parseArgs, sha256, stackStatus, writeJson } from "./backup-lib.mjs";

const args = parseArgs();
const mode = args._[0];
if (mode !== "backup" && mode !== "restore-storage") {
  console.error("usage: backup-storage.mjs backup --out DIR | restore-storage --from DIR  [--url U --secret K | --workdir W]");
  process.exit(2);
}

function target() {
  if (args.url && args.secret) return { url: args.url, secret: args.secret };
  if (args.workdir) return stackStatus(args.workdir);
  const env = loadEnvFile(args["env-file"]);
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, secret: env.SUPABASE_SECRET_KEY };
}
const { url, secret } = target();
assertTargetAllowed(url, args, mode);
const sb = createClient(url, secret, { auth: { persistSession: false } });
const PAGE = 1000;

async function listAll(bucket, prefix = "", out = []) {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const it of data ?? []) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) await listAll(bucket, p, out);
      else out.push({ bucket, path: p, size: it.metadata?.size ?? null, mimetype: it.metadata?.mimetype ?? null });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function download(bucket, p) {
  const { data, error } = await sb.storage.from(bucket).download(p);
  if (error) throw new Error(`download ${bucket}/${p}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

let failures = 0;
if (mode === "backup") {
  if (!args.out) { console.error("--out DIR required"); process.exit(2); }
  const out = path.resolve(args.out);
  const { data: bucketRows, error } = await sb.storage.listBuckets();
  if (error) { console.error(error.message); process.exit(1); }
  const wanted = args.buckets ? String(args.buckets).split(",") : bucketRows.map((b) => b.id);
  const buckets = {};
  const objects = [];
  for (const b of wanted) {
    const meta = bucketRows.find((r) => r.id === b);
    if (!meta) { console.error(`bucket ${b} not found`); failures++; continue; }
    const list = await listAll(b);
    let bytes = 0;
    for (const o of list) {
      try {
        const buf = await download(b, o.path);
        const dest = path.join(out, "objects", b, ...o.path.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        bytes += buf.length;
        objects.push({ ...o, size: buf.length, sha256: sha256(buf) });
      } catch (e) { console.error(e.message); failures++; }
    }
    buckets[b] = { public: meta.public, file_size_limit: meta.file_size_limit, allowed_mime_types: meta.allowed_mime_types, count: list.length, bytes };
    console.log(`${b}: ${list.length} objects, ${bytes} bytes`);
  }
  writeJson(path.join(out, "storage-checksums.json"), { generated_at: new Date().toISOString(), source: url, buckets, objects });
} else {
  if (!args.from) { console.error("--from DIR required"); process.exit(2); }
  const from = path.resolve(args.from);
  const man = JSON.parse(fs.readFileSync(path.join(from, "storage-checksums.json"), "utf8"));
  const { data: existing } = await sb.storage.listBuckets();
  for (const [b, meta] of Object.entries(man.buckets)) {
    if (!existing?.some((e) => e.id === b)) {
      // Buckets normally come from the migrations; create only if a migration did not.
      const { error } = await sb.storage.createBucket(b, { public: meta.public, fileSizeLimit: meta.file_size_limit ?? undefined, allowedMimeTypes: meta.allowed_mime_types ?? undefined });
      if (error) { console.error(`create bucket ${b}: ${error.message}`); failures++; }
    }
  }
  let uploaded = 0;
  for (const o of man.objects) {
    const buf = fs.readFileSync(path.join(from, "objects", o.bucket, ...o.path.split("/")));
    if (sha256(buf) !== o.sha256) { console.error(`local file checksum mismatch ${o.bucket}/${o.path}`); failures++; continue; }
    const { error } = await sb.storage.from(o.bucket).upload(o.path, buf, { contentType: o.mimetype ?? undefined, upsert: true });
    if (error) { console.error(`upload ${o.bucket}/${o.path}: ${error.message}`); failures++; continue; }
    uploaded++;
  }
  // Verify by reading every object back from the target.
  let verified = 0;
  for (const o of man.objects) {
    try {
      const buf = await download(o.bucket, o.path);
      if (sha256(buf) === o.sha256) verified++;
      else { console.error(`checksum mismatch after restore ${o.bucket}/${o.path}`); failures++; }
    } catch (e) { console.error(e.message); failures++; }
  }
  const counts = {};
  for (const b of Object.keys(man.buckets)) {
    const n = (await listAll(b)).length;
    counts[b] = n;
    if (n !== man.buckets[b].count) { console.error(`${b}: target has ${n} objects, backup has ${man.buckets[b].count}`); failures++; }
  }
  console.log(`uploaded ${uploaded}/${man.objects.length}, checksum-verified ${verified}/${man.objects.length}, target counts ${JSON.stringify(counts)}`);
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("OK");
