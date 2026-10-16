"use server";

import { refresh, updateTag } from "next/cache";
import { customerForAction, isUuid, MSG, type ActionResult } from "@/features/portal/session";

/**
 * Customer grants or withdraws publication consent for their own event.
 *
 * Withdrawal is enforced entirely in the database, in the same transaction as the RPC:
 * the event is unpublished, its published media rows stop being public (so /m/... and the
 * storage policy deny the very next request), the published copies are queued for deletion
 * and the storage-cleanup worker is kicked via pg_net. Here we only expire the public page
 * caches so the homepage / work listing re-render without the project on the next request.
 */
export async function customerSetConsent(eventId: string, status: "granted" | "revoked"): Promise<ActionResult> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(eventId) || (status !== "granted" && status !== "revoked"))
    return { ok: false, error: MSG.forbidden, code: "invalid" };
  const { error } = await ctx.supabase.rpc("set_publication_consent", { p_event_id: eventId, p_status: status });
  if (error) {
    if (error.code === "42501" || error.code === "P0002") return { ok: false, error: MSG.forbidden, code: "forbidden" };
    return { ok: false, error: MSG.unavailable, code: "unavailable" };
  }
  updateTag("projects");
  updateTag("media");
  refresh();
  return { ok: true, data: null };
}
