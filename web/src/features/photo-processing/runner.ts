import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALBUM_BUCKET, ALBUM_MAX_PIXELS, FORMATS, formatByMime, maxBytesFor, sniffFormat } from "@/features/albums-admin/rules";
import { JOB_BATCH, JOB_TIME_BUDGET_MS, SHA256_RE, makeVariants, sha256Hex, variantPaths } from "./core";
import { RAW_DECODE_TIMEOUT_MS, decodeRaw } from "./raw";

/**
 * Server-side photo processing queue worker (docs/cms-contract.md → Albums → Processing; migration 0018).
 *
 * Correctness never depends on a browser: the admin page only uploads originals and leaves rows `pending`.
 * This worker is run by `POST /api/jobs/process-photos` (pg_cron → pg_net every minute) and, for immediate
 * feedback, by the admin page's server action. Both paths use the same DB RPCs (service role only):
 *   claim_photo_jobs(p_limit)  → atomically flips claimable rows to `processing`, attempts+1 (SKIP LOCKED).
 *                                Claimable (0025): `pending` = upload CONFIRMED complete by the server (the browser
 *                                is still sending while a row is `uploading`, which is never claimed), failed with
 *                                attempts < 5, processing stale > 10 min.
 *   complete_photo_job(...)    → ready (+own thumb/display paths, dims) or failed (+last_error). After the 5th
 *                                failure the row stays failed until an admin requeues it (requeue_album_photos).
 * The checksum recorded at upload (browser, streamed sha256) is verified here against the stored bytes, the real
 * format is re-detected from the bytes, and RAW is decoded with LibRaw (./raw.ts). The original is only read.
 * Never accepts paths or ids from the request; it only processes rows the claim RPC hands out.
 */
type Claimed = { id: string; album_id: string; storage_path_original: string; mime: string; attempts: number };
export type JobOutcome = { id: string; ok: boolean; error?: string };
export type RunSummary = { claimed: number; ready: number; failed: number; outcomes: JobOutcome[]; ms: number };

// The generated DB types may lag behind the CMS migrations; the RPCs are called through an untyped view.
type Untyped = SupabaseClient;

type Done = { ok: true; variants: Record<string, string>; width: number | null; height: number | null } | { ok: false; error: string };

async function complete(sb: Untyped, id: string, r: Done) {
  const { error } = await sb.rpc("complete_photo_job", {
    p_id: id,
    p_ok: r.ok,
    p_error: r.ok ? null : r.error.slice(0, 500),
    p_width: r.ok ? r.width : null,
    p_height: r.ok ? r.height : null,
    p_variants: r.ok ? r.variants : null,
  });
  if (error) throw new Error(`complete_photo_job: ${error.message}`);
}

/** Decode a RAW within what is left of this invocation. A decode cut short by the function's own deadline is a
 *  transient failure (retried with backoff); one that used the full RAW_DECODE_TIMEOUT_MS is permanent. */
async function decodeRawInBudget(input: Buffer, deadline: number) {
  const left = deadline - Date.now();
  if (left < 5_000) throw new Error("RAW decode deferred (worker time budget) — retried automatically");
  const full = left >= RAW_DECODE_TIMEOUT_MS;
  try {
    return await decodeRaw(input, { timeoutMs: full ? RAW_DECODE_TIMEOUT_MS : left });
  } catch (e) {
    if (!full && e instanceof Error && /timed out/.test(e.message)) throw new Error("RAW decode deferred (worker time budget) — retried automatically");
    throw e;
  }
}

async function processOne(sb: Untyped, job: Claimed, deadline: number): Promise<JobOutcome> {
  const path = job.storage_path_original;
  let format: ReturnType<typeof formatByMime> = null;
  try {
    format = formatByMime(job.mime);
    if (!format) throw new Error("unsupported type");
    const dl = await sb.storage.from(ALBUM_BUCKET).download(path);
    if (dl.error || !dl.data) throw new Error("original not found in storage");
    const input = Buffer.from(await dl.data.arrayBuffer());
    if (!input.length || input.length > maxBytesFor(format)) throw new Error("original size out of range");
    // The bytes must really be the declared format (a renamed or forged file never gets variants).
    if (sniffFormat(new Uint8Array(input.subarray(0, 64)), path) !== format) throw new Error("file content does not match its type");
    const actual = sha256Hex(input);
    const { data: row } = await sb.from("album_photos").select("sha256").eq("id", job.id).maybeSingle();
    const expected = (row?.sha256 as string | null | undefined) ?? null;
    if (expected && SHA256_RE.test(expected) && expected !== actual) throw new Error("checksum mismatch (upload corrupted)");
    const v = FORMATS[format].kind === "raw" ? await makeVariants(await decodeRawInBudget(input, deadline)) : await makeVariants(input, ALBUM_MAX_PIXELS);
    const paths = variantPaths(path);
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000" };
    const [t, d] = await Promise.all([
      sb.storage.from(ALBUM_BUCKET).upload(paths.thumb, v.thumb, opts),
      sb.storage.from(ALBUM_BUCKET).upload(paths.display, v.display, opts),
    ]);
    if (t.error || d.error) throw new Error("variant upload failed");
    // Verified size/format (+ checksum for rows created before sha256 existed). Worker bookkeeping, service role.
    await sb.from("album_photos").update({ bytes: input.length, format, ...(expected ? {} : { sha256: actual }) }).eq("id", job.id);
    await complete(sb, job.id, { ok: true, variants: paths, width: v.width, height: v.height });
    return { id: job.id, ok: true };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (/Input image exceeds pixel limit/i.test(msg)) msg = "image too large (pixel limit)";
    else if (/unsupported image format|Input (buffer|file) (contains unsupported|has corrupt header)|premature end of|contains no image|VipsJpeg|VipsPng|VipsTiff|VipsForeign|vips_/i.test(msg)) msg = "image could not be decoded (corrupt or unsupported)";
    try {
      if (format) await sb.from("album_photos").update({ format }).eq("id", job.id);
      await complete(sb, job.id, { ok: false, error: msg });
      // Retrying cannot fix these: park them (no automatic retries; the admin can still requeue manually).
      if (PERMANENT.test(msg)) await sb.from("album_photos").update({ attempts: 5 }).eq("id", job.id).eq("upload_status", "failed");
    } catch {
      /* row stays `processing`; reclaimed as stale after 10 minutes */
    }
    return { id: job.id, ok: false, error: msg };
  }
}

/** Failures that will be identical on every attempt (content problems), as opposed to transient storage/network
 *  errors which keep their automatic retries (with backoff, migration 0025). */
const PERMANENT = /RAW file could not be read|RAW decode failed|RAW decode timed out|unexpected pixel format|truncated image|image could not be decoded|file content does not match|image too large|checksum mismatch|size out of range|unsupported type|original not found/i;

/** Uploads abandoned mid-way (tab closed, never completed): rows still `uploading` after 24 h. Their partial TUS
 *  data expires on its own; the row (no original stored) is removed so the album does not keep ghost entries.
 *  Only rows whose original does NOT exist are touched — a completed object is never deleted here. */
async function pruneAbandonedUploads(sb: Untyped): Promise<number> {
  const { data } = await sb
    .from("album_photos")
    .select("id, storage_path_original")
    .eq("upload_status", "uploading")
    .lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(50);
  let n = 0;
  for (const r of data ?? []) {
    const info = await sb.storage.from(ALBUM_BUCKET).info(r.storage_path_original);
    if (info.data) continue;
    const del = await sb.from("album_photos").delete().eq("id", r.id).eq("upload_status", "uploading").select("id");
    n += del.data?.length ?? 0;
  }
  return n;
}

/** One decode at a time per server instance (RAW decoding peaks around 600 MB): concurrent triggers in the same
 *  instance wait for the running loop instead of decoding in parallel. Other instances work in parallel safely
 *  (the claim RPC uses SKIP LOCKED). */
let running: Promise<RunSummary> | null = null;

/** Claims and processes up to `limit` jobs, one at a time (one image decoded at a time; an interrupted
 *  run leaves at most one row in `processing`, which is reclaimed when stale). */
export async function runPhotoJobs(opts: { limit?: number; budgetMs?: number } = {}): Promise<RunSummary> {
  while (running) await running.catch(() => undefined);
  running = runPhotoJobsOnce(opts);
  try {
    return await running;
  } finally {
    running = null;
  }
}

async function runPhotoJobsOnce(opts: { limit?: number; budgetMs?: number }): Promise<RunSummary> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? JOB_BATCH, JOB_BATCH));
  const budget = opts.budgetMs ?? JOB_TIME_BUDGET_MS;
  // Hard stop for a single decode: new jobs start until `budget`, a running RAW decode is cut at budget + 10 s
  // (inside the 60 s function limit).
  const deadline = started + budget + 10_000;
  const sb = createAdminClient() as unknown as Untyped;
  try {
    await pruneAbandonedUploads(sb);
  } catch {
    /* housekeeping only */
  }
  const outcomes: JobOutcome[] = [];
  while (outcomes.length < limit && Date.now() - started < budget) {
    const { data, error } = await sb.rpc("claim_photo_jobs", { p_limit: 1 });
    if (error) throw new Error(`claim_photo_jobs: ${error.message}`);
    const jobs = (data ?? []) as Claimed[];
    if (!jobs.length) break;
    for (const job of jobs) outcomes.push(await processOne(sb, job, deadline));
  }
  return {
    claimed: outcomes.length,
    ready: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
    ms: Date.now() - started,
  };
}
