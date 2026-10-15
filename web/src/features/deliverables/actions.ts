"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { signMediaUrls } from "@/features/media/sign";
import { customerForAction, isUuid, MSG, type ActionResult } from "@/features/portal/session";

const noteSchema = z.string().trim().min(3, "اكتب ما تودّ تعديله بوضوح.").max(4000, "الملاحظة طويلة جداً.");

export async function requestRevision(deliverableId: string, note: string): Promise<ActionResult> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  const parsed = noteSchema.safeParse(note);
  if (!isUuid(deliverableId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "", code: "invalid" };
  const { error } = await ctx.supabase.rpc("customer_request_revision", {
    p_deliverable_id: deliverableId,
    p_note: parsed.data,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, error: "لا يمكن طلب تعديل على هذا العمل في مرحلته الحالية.", code: "locked" };
    if (error.code === "42501") return { ok: false, error: MSG.forbidden, code: "forbidden" };
    return { ok: false, error: MSG.unavailable, code: "unavailable" };
  }
  refresh();
  return { ok: true, data: null };
}

/** Fresh download link for one asset (renewed on every click). */
export async function getDownloadUrl(assetId: string): Promise<ActionResult<{ url: string }>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(assetId)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const [s] = await signMediaUrls({ assetIds: [assetId], variant: "original", ttlSeconds: 120, download: true });
  if (!s?.url) return { ok: false, error: "الملف غير متاح للتنزيل الآن.", code: "forbidden" };
  return { ok: true, data: { url: s.url } };
}
