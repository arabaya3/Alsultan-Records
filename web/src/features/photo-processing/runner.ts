import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ALBUM_BUCKET, ALBUM_MAX_BYTES, ALBUM_MIME_EXT } from "@/features/albums-admin/rules";
import { JOB_BATCH, JOB_TIME_BUDGET_MS, SHA256_RE, makeVariants, sha256Hex, variantPaths } from "./core";

/**
 * Server-side photo processing queue worker (docs/cms-contract.md → Albums → Processing; migration 0018).
 *
 * Correctness never depends on a browser: the admin page only uploads originals and leaves rows `pending`.
 * This worker is run by `POST /api/jobs/process-photos` (pg_cron → pg_net every minute) and, for immediate
 * feedback, by the admin page's server action. Both paths use the same DB RPCs (service role only):
 *   claim_photo_jobs(p_limit)  → atomically flips claimable rows to `processing`, attempts+1 (SKIP LOCKED).
 *                                Claimable: pending > 2 min (browser may still be uploading), failed with
 *                                attempts < 5, processing stale > 10 min.
 *   complete_photo_job(...)    → ready (+own thumb/display paths, dims) or failed (+last_error). After the 5th
 *                                failure the row stays failed until an admin requeues it (requeue_album_photos).
 * The checksum recorded at upload (browser SubtleCrypto) is verified here against the stored bytes.
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

async function processOne(sb: Untyped, job: Claimed): Promise<JobOutcome> {
  const path = job.storage_path_original;
  try {
    if (!ALBUM_MIME_EXT[job.mime]) throw new Error("unsupported type");
    const dl = await sb.storage.from(ALBUM_BUCKET).download(path);
    if (dl.error || !dl.data) throw new Error("original not found in storage");
    const input = Buffer.from(await dl.data.arrayBuffer());
    if (!input.length || input.length > ALBUM_MAX_BYTES) throw new Error("original size out of range");
    const actual = sha256Hex(input);
    const { data: row } = await sb.from("album_photos").select("sha256").eq("id", job.id).maybeSingle();
    const expected = (row?.sha256 as string | null | undefined) ?? null;
    if (expected && SHA256_RE.test(expected) && expected !== actual) throw new Error("checksum mismatch (upload corrupted)");
    const v = await makeVariants(input);
    const paths = variantPaths(path);
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000" };
    const [t, d] = await Promise.all([
      sb.storage.from(ALBUM_BUCKET).upload(paths.thumb, v.thumb, opts),
      sb.storage.from(ALBUM_BUCKET).upload(paths.display, v.display, opts),
    ]);
    if (t.error || d.error) throw new Error("variant upload failed");
    // Verified size (+ checksum for rows created before sha256 existed). Worker bookkeeping, service role.
    await sb.from("album_photos").update({ bytes: input.length, ...(expected ? {} : { sha256: actual }) }).eq("id", job.id);
    await complete(sb, job.id, { ok: true, variants: paths, width: v.width, height: v.height });
    return { id: job.id, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await complete(sb, job.id, { ok: false, error: msg });
    } catch {
      /* row stays `processing`; reclaimed as stale after 10 minutes */
    }
    return { id: job.id, ok: false, error: msg };
  }
}

/** Claims and processes up to `limit` jobs, one at a time (one image decoded at a time; an interrupted
 *  run leaves at most one row in `processing`, which is reclaimed when stale). */
export async function runPhotoJobs(opts: { limit?: number; budgetMs?: number } = {}): Promise<RunSummary> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? JOB_BATCH, JOB_BATCH));
  const budget = opts.budgetMs ?? JOB_TIME_BUDGET_MS;
  const sb = createAdminClient() as unknown as Untyped;
  const outcomes: JobOutcome[] = [];
  while (outcomes.length < limit && Date.now() - started < budget) {
    const { data, error } = await sb.rpc("claim_photo_jobs", { p_limit: 1 });
    if (error) throw new Error(`claim_photo_jobs: ${error.message}`);
    const jobs = (data ?? []) as Claimed[];
    if (!jobs.length) break;
    for (const job of jobs) outcomes.push(await processOne(sb, job));
  }
  return {
    claimed: outcomes.length,
    ready: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
    ms: Date.now() - started,
  };
}
