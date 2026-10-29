import type { SupabaseClient } from "@supabase/supabase-js";
import { SaveError, type JobPatch } from "./worker";

/** Writes one patch and checks it really landed: a DB error or 0 updated rows throws SaveError (nothing more is sent). */
export function checkedSave(sb: SupabaseClient) {
  return async (id: string, patch: JobPatch) => {
    const { data, error } = await sb
      .from("facebook_reel_posts")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) throw new SaveError(`save failed: ${error.code ?? "db"}`);
    if (!Array.isArray(data) || data.length !== 1) throw new SaveError("save failed: job row not updated");
  };
}
