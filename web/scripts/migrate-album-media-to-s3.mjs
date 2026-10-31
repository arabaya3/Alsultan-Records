/**
 * Copies album objects from Supabase Storage to S3. Nothing is ever deleted from the source.
 *
 *   node scripts/migrate-album-media-to-s3.mjs --manifest <file>            # dry run: counts and sizes only
 *   node scripts/migrate-album-media-to-s3.mjs --manifest <file> --copy     # copy and verify (resumable)
 *   node scripts/migrate-album-media-to-s3.mjs --manifest <file> --copy --switch   # also point verified photos at S3
 *
 * Environment: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, S3_*. ENV_FILE=<path> loads them from a file.
 * Target guard: MIGRATE_TARGET must equal the project ref in the URL, or "local" for a loopback URL.
 *
 * Each object is streamed: part by part to S3 while hashing, then read back from S3 and hashed again, so neither the
 * memory nor the disk ever holds the collection. S3 ETags are never treated as MD5. An object already at the
 * destination is hashed against the source: identical is kept, different stops that photo and is never overwritten.
 * A photo switches only when its original and both variants are verified, and only if it is still `ready`, on Supabase,
 * with the same paths. Originals are also checked against the sha256 recorded in the database.
 * If Supabase refuses for a plan restriction (HTTP 402) the run stops: it does not try another way round.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

const has = (f) => process.argv.includes(f);
const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : null);
const env = { ...process.env };
if (process.env.ENV_FILE) {
  for (const l of fs.readFileSync(process.env.ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const COPY = has("--copy"), SWITCH = has("--switch");
const manifestPath = arg("--manifest");
if (!manifestPath) throw new Error("--manifest <file> is required");
if (SWITCH && !COPY) throw new Error("--switch needs --copy");
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[k]) throw new Error(`missing ${k}`);
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(URL_BASE)?.[1] ?? (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_BASE) ? "local" : null);
if (!ref || env.MIGRATE_TARGET !== ref) throw new Error("MIGRATE_TARGET does not match the Supabase URL: nothing was done");

const KEY = env.SUPABASE_SECRET_KEY;
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const Bucket = env.S3_BUCKET;
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === "1",
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const PART = 16 * 1024 * 1024;
const WORKERS = Number(arg("--workers") ?? 3);

class PlanLimit extends Error {}
const planCheck = (r) => {
  if (r.status === 402) throw new PlanLimit("Supabase refused with 402 (plan restriction)");
};

const manifest = new Map();
if (fs.existsSync(manifestPath)) {
  for (const l of fs.readFileSync(manifestPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l);
      manifest.set(e.path, e);
    } catch {
      /* torn last line from an interruption: that object is checked again */
    }
  }
}
const record = (e) => {
  manifest.set(e.path, e);
  fs.appendFileSync(manifestPath, `${JSON.stringify(e)}\n`);
};

async function* photoPages() {
  for (let last = "00000000-0000-0000-0000-000000000000"; ; ) {
    const r = await fetch(`${URL_BASE}/rest/v1/album_photos?select=id,storage_path_original,variants,sha256,upload_status,storage_provider&id=gt.${last}&order=id&limit=500`, { headers: auth });
    planCheck(r);
    if (!r.ok) throw new Error(`photo list ${r.status}`);
    const rows = await r.json();
    if (!rows.length) return;
    yield rows;
    last = rows[rows.length - 1].id;
  }
}

async function sourceStream(path) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/album-media/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: auth });
  planCheck(r);
  if (!r.ok || !r.body) throw new Error(`source ${r.status}`);
  return { stream: Readable.fromWeb(r.body), contentType: r.headers.get("content-type") ?? "application/octet-stream" };
}
async function hashStream(stream) {
  const h = crypto.createHash("sha256");
  let size = 0;
  for await (const c of stream) {
    h.update(c);
    size += c.length;
  }
  return { sha256: h.digest("hex"), size };
}
async function destHead(key) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
    throw e;
  }
}
const destHash = async (key) => hashStream((await s3.send(new GetObjectCommand({ Bucket, Key: key }))).Body);

/** Streams the source to S3 in parts, hashing as it goes. */
async function send(path) {
  const { stream, contentType } = await sourceStream(path);
  const h = crypto.createHash("sha256");
  let size = 0, n = 0, pending = [], held = 0, UploadId = null;
  const parts = [];
  const flush = async () => {
    const body = Buffer.concat(pending, held);
    pending = [];
    held = 0;
    if (!UploadId) UploadId = (await s3.send(new CreateMultipartUploadCommand({ Bucket, Key: path, ContentType: contentType }))).UploadId;
    n++;
    const r = await s3.send(new UploadPartCommand({ Bucket, Key: path, UploadId, PartNumber: n, Body: body }));
    parts.push({ PartNumber: n, ETag: r.ETag });
  };
  try {
    for await (const c of stream) {
      h.update(c);
      size += c.length;
      pending.push(c);
      held += c.length;
      if (held >= PART) await flush();
    }
    if (UploadId) {
      if (held) await flush();
      await s3.send(new CompleteMultipartUploadCommand({ Bucket, Key: path, UploadId, MultipartUpload: { Parts: parts } }));
    } else {
      await s3.send(new PutObjectCommand({ Bucket, Key: path, Body: Buffer.concat(pending, held), ContentType: contentType }));
    }
  } catch (e) {
    if (UploadId) await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: path, UploadId })).catch(() => {});
    throw e;
  }
  return { sha256: h.digest("hex"), size };
}

/** Verified copy of one object, or throws. The manifest entry is written only after reading the copy back. */
async function copyOne(path, expectedSha) {
  const known = manifest.get(path);
  if (known?.verified && (!expectedSha || known.sha256 === expectedSha)) return known;
  let src;
  if (await destHead(path)) {
    src = await hashStream((await sourceStream(path)).stream);
    const dst = await destHash(path);
    if (dst.sha256 !== src.sha256 || dst.size !== src.size) throw new Error("conflict: a different object is already at the destination");
  } else {
    src = await send(path);
    const dst = await destHash(path);
    if (dst.sha256 !== src.sha256 || dst.size !== src.size) throw new Error("copy does not match the source");
  }
  if (expectedSha && src.sha256 !== expectedSha) throw new Error("source does not match the recorded sha256");
  const entry = { path, source: "supabase:album-media", dest: `s3:${Bucket}`, size: src.size, sha256: src.sha256, verified: true, at: new Date().toISOString() };
  record(entry);
  return entry;
}

const pathsOf = (p) => [p.storage_path_original, p.variants?.thumb, p.variants?.display].filter(Boolean);

async function switchPhoto(p) {
  const q = new URLSearchParams({ id: `eq.${p.id}`, storage_provider: "eq.supabase", upload_status: "eq.ready", storage_path_original: `eq.${p.storage_path_original}`, select: "id" });
  const r = await fetch(`${URL_BASE}/rest/v1/album_photos?${q}`, { method: "PATCH", headers: { ...auth, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ storage_provider: "s3" }) });
  planCheck(r);
  if (!r.ok) throw new Error(`switch ${r.status}`);
  return (await r.json()).length === 1;
}

const stats = { photos: 0, onS3: 0, ready: 0, notReady: 0, objects: 0, verifiedAlready: 0, copied: 0, switched: 0, failed: 0 };
const reasons = {};
let stop = null;

async function handle(p) {
  stats.photos++;
  if (p.storage_provider === "s3") return void stats.onS3++;
  if (p.upload_status === "ready") stats.ready++;
  else stats.notReady++;
  const paths = pathsOf(p);
  stats.objects += paths.length;
  stats.verifiedAlready += paths.filter((x) => manifest.get(x)?.verified).length;
  if (!COPY || p.upload_status !== "ready" || stop) return;
  try {
    for (const path of paths) {
      const had = manifest.get(path)?.verified;
      await copyOne(path, path === p.storage_path_original ? p.sha256 : null);
      if (!had) stats.copied++;
    }
    const complete = p.variants?.thumb && p.variants?.display;
    if (SWITCH && complete && (await switchPhoto(p))) stats.switched++;
  } catch (e) {
    if (e instanceof PlanLimit) {
      stop = e.message;
      return;
    }
    stats.failed++;
    const why = e instanceof Error ? e.message : "error";
    reasons[why] = (reasons[why] ?? 0) + 1;
    fs.appendFileSync(`${manifestPath}.failed`, `${JSON.stringify({ id: p.id, why, at: new Date().toISOString() })}\n`);
  }
}

try {
  for await (const page of photoPages()) {
    const queue = [...page];
    await Promise.all(Array.from({ length: WORKERS }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await handle(p);
    }));
    if (stop) break;
  }
} catch (e) {
  if (!(e instanceof PlanLimit)) throw e;
  stop = e.message;
}
const bytes = [...manifest.values()].reduce((a, e) => a + (e.size ?? 0), 0);
console.log(JSON.stringify({ mode: !COPY ? "dry-run" : SWITCH ? "copy+switch" : "copy", ...stats, verifiedBytesGB: +(bytes / 1e9).toFixed(2), reasons, stoppedBy: stop }));
process.exit(stop || stats.failed ? 1 : 0);
