import type { SupabaseClient } from "@supabase/supabase-js";
import { SaveError, type JobPatch } from "./worker";

/**
 * Writes one patch and checks it really landed: a DB error or 0 updated rows throws SaveError (nothing more is sent).
 * Every write is conditioned on the worker's lease (migration 0030): once the lease expired and another worker
 * claimed the job, this stale worker matches 0 rows and stops instead of overwriting the current one.
 */
export function checkedSave(sb: SupabaseClient, leaseToken: string | null | undefined) {
  return async (id: string, patch: JobPatch) => {
    if (!leaseToken) throw new SaveError("save failed: job has no lease");
    const { data, error } = await sb
      .from("facebook_reel_posts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("lease_token", leaseToken)
      .select("id");
    if (error) throw new SaveError(`save failed: ${error.code ?? "db"}`);
    if (!Array.isArray(data) || data.length !== 1) throw new SaveError("save failed: job row not updated (lease lost?)");
  };
}

/** End of this worker's turn: give the lease back so the job is claimable at its next_attempt_at. */
export async function releaseLease(sb: SupabaseClient, id: string, leaseToken: string) {
  await sb.from("facebook_reel_posts").update({ lease_token: null, lease_until: null }).eq("id", id).eq("lease_token", leaseToken);
}
