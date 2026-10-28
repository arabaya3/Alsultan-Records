import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob, type Job } from "./worker";

const BUCKET = "reel-media";
/** Meta pulls the file from this URL during the upload call; one hour is ample and then it expires. */
const SIGNED_URL_SECONDS = 3600;

/** Claims due jobs (respecting Meta's 24 h limit in SQL) and advances each one step. Never logs the token. */
export async function runFacebookJobs(): Promise<{ claimed: number; published: number; waiting: number; failed: number }> {
  // Generated DB types lag migration 0027: untyped view, as elsewhere for CMS tables.
  const sb = createAdminClient() as unknown as SupabaseClient;
  const out = { claimed: 0, published: 0, waiting: 0, failed: 0 };
  if (!sb) return out;
  const { data: jobs, error } = await sb.rpc("claim_facebook_jobs", { p_limit: 2 });
  if (error || !Array.isArray(jobs) || !jobs.length) return out;
  const [{ data: token }, { data: conn }] = await Promise.all([
    sb.rpc("meta_page_token"),
    sb.from("meta_page_connection").select("page_id, status").eq("id", 1).maybeSingle(),
  ]);
  const pageId = conn && (conn as { status: string }).status === "connected" ? (conn as { page_id: string }).page_id : null;
  for (const j of jobs as Job[]) {
    out.claimed++;
    const r = await runJob(j, {
      fetch: (u, i) => fetch(u, { ...i, cache: "no-store" }),
      token: typeof token === "string" ? token : null,
      pageId,
      signedFileUrl: async (reelId) => {
        const { data: v } = await sb.from("reel_videos").select("storage_path").eq("id", reelId).maybeSingle();
        if (!v) return null;
        const s = await sb.storage.from(BUCKET).createSignedUrl((v as { storage_path: string }).storage_path, SIGNED_URL_SECONDS);
        return s.data?.signedUrl ?? null;
      },
      save: async (id, patch) => {
        await sb.from("facebook_reel_posts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      },
      connectionLost: async (reason) => {
        await sb.rpc("meta_disconnect", { p_status: "expired", p_error: reason });
      },
    });
    if (r.status === "published") out.published++;
    else if (r.status === "failed") out.failed++;
    else out.waiting++;
  }
  return out;
}
