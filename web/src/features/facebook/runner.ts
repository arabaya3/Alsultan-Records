import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { REQUEST_TIMEOUT_MS } from "./graph";
import { checkedSave, releaseLease } from "./save";
import { runJob, SaveError, type Job, type JobPatch } from "./worker";

const BUCKET = "reel-media";
/** Meta pulls the file from this URL during the upload call; one hour is ample and then it expires. */
const SIGNED_URL_SECONDS = 3600;
/** Route maxDuration is 60 s. A job makes at most 4 Meta requests (start, status, upload, finish); a new job only
 *  starts while that worst case still fits, so the function never ends with a job cut half-way by the platform. */
const RUN_BUDGET_MS = 55_000;
const JOB_WORST_MS = 4 * REQUEST_TIMEOUT_MS;

/** Claims due jobs (respecting Meta's 24 h limit in SQL) and advances each one step. Never logs the token. */
export async function runFacebookJobs(
  clock: () => number = Date.now,
): Promise<{ claimed: number; published: number; waiting: number; failed: number; saveErrors: number; deferred: number }> {
  // Generated DB types lag migration 0027: untyped view, as elsewhere for CMS tables.
  const sb = createAdminClient() as unknown as SupabaseClient;
  const out = { claimed: 0, published: 0, waiting: 0, failed: 0, saveErrors: 0, deferred: 0 };
  if (!sb) return out;
  const startedAt = clock();
  const { data: jobs, error } = await sb.rpc("claim_facebook_jobs", { p_limit: 2 });
  if (error || !Array.isArray(jobs) || !jobs.length) return out;
  const [{ data: token, error: tokenErr }, { data: conn, error: connErr }] = await Promise.all([
    sb.rpc("meta_page_token"),
    sb.from("meta_page_connection").select("page_id, status").eq("id", 1).maybeSingle(),
  ]);
  // Could not read the connection: send nothing; the claimed jobs are picked up again after the stale window.
  if (tokenErr || connErr) return { ...out, claimed: jobs.length, deferred: jobs.length };
  const pageId = conn && (conn as { status: string }).status === "connected" ? (conn as { page_id: string }).page_id : null;
  for (const j of jobs as Job[]) {
    out.claimed++;
    if (clock() - startedAt + JOB_WORST_MS > RUN_BUDGET_MS) {
      // Not enough time left for the worst case: hand it back untouched (status/next attempt unchanged).
      await sb
        .from("facebook_reel_posts")
        .update({ status: j.finish_requested_at ? "processing" : "queued", attempts: j.attempts - 1, lease_token: null, lease_until: null })
        .eq("id", j.id)
        .eq("lease_token", j.lease_token ?? "");
      out.deferred++;
      continue;
    }
    let r: JobPatch;
    try {
      r = await runJob(j, {
        fetch: (u, i) => fetch(u, { ...i, cache: "no-store" }),
        token: typeof token === "string" ? token : null,
        pageId,
        signedFileUrl: async (reelId) => {
          const { data: v } = await sb.from("reel_videos").select("storage_path").eq("id", reelId).maybeSingle();
          if (!v) return null;
          const s = await sb.storage.from(BUCKET).createSignedUrl((v as { storage_path: string }).storage_path, SIGNED_URL_SECONDS);
          return s.data?.signedUrl ?? null;
        },
        save: checkedSave(sb, j.lease_token),
        connectionLost: async (reason) => {
          const { data, error: lostErr } = await sb.rpc("meta_connection_lost", { p_job: j.id, p_lease: j.lease_token, p_error: reason });
          if (lostErr || data !== true) throw new SaveError("connection report refused (lease lost?)");
        },
      });
    } catch (e) {
      if (!(e instanceof SaveError)) throw e;
      // The database is not taking writes, or our lease was lost: stop the whole run. The job is reclaimed when its
      // lease expires (or is already in the hands of the worker that holds the current lease).
      out.saveErrors++;
      break;
    }
    if (j.lease_token) await releaseLease(sb, j.id, j.lease_token);
    if (r.status === "published") out.published++;
    else if (r.status === "failed") out.failed++;
    else out.waiting++;
  }
  return out;
}
