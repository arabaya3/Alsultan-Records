import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CleanupItem = { id: string; bucket: string; path: string; ok: boolean; error?: string };
export type CleanupReport = { claimed: number; removed: number; failed: CleanupItem[]; error?: string };

const BUCKETS = new Set(["public-media", "private-media"]);

/**
 * Storage cleanup worker (migration 0008 queue). CALLER MUST HAVE PASSED an
 * owner/admin role check (guard(ADMIN_ROLES)) before calling.
 *
 * 1. claim_storage_cleanup(limit) with the caller's client (RPC re-checks admin).
 * 2. Remove each claimed object with the secret-key client. Documented exception:
 *    queued paths include private-media objects of deleted events (their rows and
 *    events are gone, so no RLS policy can authorize the delete any more).
 * 3. complete_storage_cleanup(ids) ONLY for objects removed (or already absent);
 *    fail_storage_cleanup for the rest (backoff + dead-letter, migration 0010).
 * The scheduled worker is the storage-cleanup Edge Function (pg_cron, every minute); this
 * in-app runner is the manual "run now" button and the admin-flow fast path.
 */
export async function processStorageCleanup(limit = 100): Promise<CleanupReport> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("claim_storage_cleanup", { p_limit: limit });
  if (error) return { claimed: 0, removed: 0, failed: [], error: error.code === "42501" ? "forbidden" : "claim" };
  const items = data ?? [];
  if (!items.length) return { claimed: 0, removed: 0, failed: [] };
  const admin = createAdminClient();
  const results: CleanupItem[] = [];
  for (const it of items) {
    if (!BUCKETS.has(it.bucket) || !it.path || it.path.includes("..")) {
      results.push({ id: it.id, bucket: it.bucket, path: it.path, ok: false, error: "invalid path" });
      continue;
    }
    // remove() succeeds for objects that no longer exist, which is the desired end state.
    const rm = await admin.storage.from(it.bucket).remove([it.path]);
    results.push({ id: it.id, bucket: it.bucket, path: it.path, ok: !rm.error, error: rm.error?.message });
  }
  const done = results.filter((r) => r.ok).map((r) => r.id);
  let completeError: string | undefined;
  if (done.length) {
    const c = await sb.rpc("complete_storage_cleanup", { p_ids: done });
    if (c.error) completeError = "complete";
  }
  // Failures: attempts+1 with backoff, dead-letter after 5 (same contract as the Edge Function).
  for (const f of results.filter((r) => !r.ok)) {
    await sb.rpc("fail_storage_cleanup", { p_ids: [f.id], p_error: f.error ?? "error" });
  }
  return { claimed: items.length, removed: done.length, failed: results.filter((r) => !r.ok), error: completeError };
}

export function cleanupMessage(r: CleanupReport): string {
  if (r.error === "forbidden") return "ليست لديك صلاحية تنظيف التخزين.";
  if (r.error === "claim") return "تعذّر قراءة قائمة الملفات المطلوب حذفها.";
  if (!r.claimed) return "لا توجد ملفات بانتظار الحذف.";
  let m = `حُذف ${r.removed} من ${r.claimed} ملفاً من التخزين.`;
  if (r.failed.length) m += ` تعذّر ${r.failed.length} (سيُعاد المحاولة لاحقاً): ${r.failed.slice(0, 3).map((f) => f.path.split("/").pop()).join("، ")}`;
  if (r.error === "complete") m += " تعذّر تعليمها كمنجزة؛ ستُعاد معالجتها بأمان.";
  return m;
}
