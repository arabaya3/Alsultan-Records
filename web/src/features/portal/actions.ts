"use server";

import { refresh } from "next/cache";
import { customerForAction, isUuid, MSG, type ActionResult } from "./session";

export async function acceptQuote(quoteId: string): Promise<ActionResult> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(quoteId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const { error } = await ctx.supabase.rpc("customer_accept_quote", { p_quote_id: quoteId });
  if (error) {
    if (error.code === "22023")
      return {
        ok: false,
        error: error.message.includes("expired") ? "انتهت صلاحية عرض السعر. تواصل معنا لتجديده." : "عرض السعر لم يعد متاحاً للقبول.",
        code: "locked",
      };
    if (error.code === "42501") return { ok: false, error: MSG.forbidden, code: "forbidden" };
    return { ok: false, error: MSG.unavailable, code: "unavailable" };
  }
  refresh();
  return { ok: true, data: null };
}

/** Approves exactly the version (id + sha256 hash) that was displayed to the customer. */
export async function approveContract(versionId: string, contentHash: string): Promise<ActionResult> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(versionId) || !/^[0-9a-f]{64}$/i.test(contentHash)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const { error } = await ctx.supabase.rpc("customer_approve_contract", {
    p_version_id: versionId,
    p_content_hash: contentHash,
  });
  if (error) {
    if (error.code === "22023")
      return {
        ok: false,
        error: "تغيّرت نسخة العقد أو لم تعد بانتظار الاعتماد. حدّث الصفحة لقراءة النسخة الحالية.",
        code: "locked",
      };
    if (error.code === "42501") return { ok: false, error: MSG.forbidden, code: "forbidden" };
    return { ok: false, error: MSG.unavailable, code: "unavailable" };
  }
  refresh();
  return { ok: true, data: null };
}
