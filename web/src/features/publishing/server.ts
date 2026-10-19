import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { cleanupMessage, processStorageCleanup } from "./cleanup";

type SB = SupabaseClient<Database>;

export const PUBLIC_BUCKET = "public-media";
export const PRIVATE_BUCKET = "private-media";

export function variantPaths(variants: Json): string[] {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return [];
  return ["thumb", "display"]
    .map((k) => (variants as Record<string, Json>)[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Remove every public copy (storage objects + media_assets rows in
 * public-media) of an event. The database flips visibility to private when an
 * event stops being public but cannot delete storage objects, so this runs
 * after unpublish / consent revoke and from the manual "cleanup" button.
 * Uses the caller's client: public-media delete and media delete are admin-only by RLS.
 */
export async function cleanupPublicMedia(
  sb: SB,
  eventId: string,
  onlyAssetIds?: string[],
): Promise<{ removed: number; failed: number }> {
  let q = sb.from("media_assets").select("id, path, variants").eq("event_id", eventId).eq("bucket", "public-media");
  if (onlyAssetIds) q = q.in("id", onlyAssetIds);
  const { data, error } = await q;
  if (error || !data) return { removed: 0, failed: 1 };
  let removed = 0;
  let failed = 0;
  for (const row of data) {
    const paths = Array.from(new Set([row.path, ...variantPaths(row.variants)]));
    const rm = await sb.storage.from(PUBLIC_BUCKET).remove(paths);
    if (rm.error) {
      failed++;
      continue;
    }
    const del = await sb.from("media_assets").delete().eq("id", row.id);
    if (del.error) failed++;
    else removed++;
  }
  return { removed, failed };
}

/**
 * Event stopped being public (unpublish / consent revoke / portal revoke):
 * the DB trigger already enqueued every public-media path of the event in the
 * cleanup queue. Here we drop the (now private) public-media rows and run the
 * queue worker so the objects disappear immediately. Caller must be admin/owner.
 */
export async function retractEventPublicCopies(sb: SB, eventId: string): Promise<{ rows: number; message: string }> {
  const del = await sb.from("media_assets").delete({ count: "exact" }).eq("event_id", eventId).eq("bucket", "public-media");
  const r = await processStorageCleanup(100);
  return { rows: del.count ?? 0, message: r.claimed ? cleanupMessage(r) : "" };
}
