import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlbumStore } from "@/lib/album-storage";
import { checkClientVariant, variantPaths, type VariantKey } from "./variant-rules";
import type { FormatId } from "./rules";

/**
 * Accept web copies the admin's browser made and stored next to the original (client-variants.ts), so the photo is
 * ready without any image decoding on Vercel. Called by completeAlbumUpload AFTER it confirmed the original (exists,
 * exact reserved size). Trust nothing from the browser except the original's pixel size, and that only to check the
 * copies: each must be a real WebP within the byte limit whose pixel size matches the recipe (variant-rules.ts).
 *
 * Returns "ready" when the row is now `ready`. On "fallback" nothing was changed and the caller falls back to the server
 * worker exactly as before (it overwrites both copies); "queued": the row is already `pending` for the worker. The row goes `uploading` → `processing` with a conditional
 * update, then complete_photo_job (service role, same RPC as the worker), so a concurrent cancel or worker cannot be
 * overtaken. Difference from the worker, by design: the original is not downloaded again to re-hash it (the browser
 * hashed it before reserving and the size is verified) — the bytes the public sees are the checked copies.
 */
export type AcceptDeps = { store: AlbumStore; admin: SupabaseClient };
export type AcceptRow = { id: string; storage_path_original: string };

export async function acceptClientVariants(deps: AcceptDeps, row: AcceptRow, original: { width: number; height: number }, format: FormatId): Promise<"ready" | "fallback" | "queued"> {
  const paths = variantPaths(row.storage_path_original);
  for (const k of ["thumb", "display"] as VariantKey[]) {
    let bytes: Buffer | null = null;
    try {
      bytes = await deps.store.download(paths[k]);
    } catch {
      return "fallback";
    }
    if (checkClientVariant(k, bytes ? new Uint8Array(bytes) : null, original)) return "fallback";
  }
  const claimed = await deps.admin
    .from("album_photos")
    .update({ upload_status: "processing", processing_started_at: new Date().toISOString(), attempts: 1, last_error: null, format })
    .eq("id", row.id)
    .eq("upload_status", "uploading")
    .is("deleted_at", null)
    .select("id");
  if (claimed.error || claimed.data?.length !== 1) return "fallback";
  const done = await deps.admin.rpc("complete_photo_job", {
    p_id: row.id,
    p_ok: true,
    p_error: null,
    p_width: original.width,
    p_height: original.height,
    p_variants: paths,
  });
  if (done.error || done.data !== true) {
    // Hand it to the worker instead of waiting for the 10-minute stale reclaim.
    await deps.admin.from("album_photos").update({ upload_status: "pending", processing_started_at: null, attempts: 0 }).eq("id", row.id).eq("upload_status", "processing");
    return "queued";
  }
  return "ready";
}
