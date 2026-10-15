"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { parseMoneyToMinor } from "@/features/admin/money";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, optDate, str, uuid, type ActionResult } from "@/features/admin/result";

const DRAFT_ONLY = { "42501": "لا يمكن تعديل المبالغ أو البنود إلا والعرض مسودة." };

export async function createQuote(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const customerId = uuid(fd, "customer_id");
  if (!customerId) return fail("اختر العميل.");
  const eventRaw = str(fd, "event_id");
  const eventId = eventRaw ? uuid(fd, "event_id") : null;
  const sb = await createClient();
  const { data, error } = await sb
    .from("quotes")
    .insert({ customer_id: customerId, event_id: eventId, valid_until: optDate(fd, "valid_until"), discount: 0 })
    .select("id")
    .single();
  if (error || !data) return fail(dbMessage(error));
  redirect(`/admin/quotes/${data.id}`);
}

export async function addQuoteItem(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const quoteId = uuid(fd, "quote_id");
  const description = str(fd, "description").slice(0, 500);
  const qtyRaw = str(fd, "qty") || "1";
  const unit = parseMoneyToMinor(str(fd, "unit_price"));
  if (!quoteId || !description) return fail("اكتب وصف البند.");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(qtyRaw) || Number(qtyRaw) <= 0) return fail("الكمية غير صالحة.");
  if (unit === null) return fail("سعر الوحدة غير صالح. مثال: 1500 أو 1500.50");
  const sb = await createClient();
  const { count } = await sb.from("quote_items").select("id", { count: "exact", head: true }).eq("quote_id", quoteId);
  const { error } = await sb
    .from("quote_items")
    .insert({ quote_id: quoteId, description, qty: Number(qtyRaw), unit_price: unit, sort_order: count ?? 0 });
  if (error) return fail(dbMessage(error, DRAFT_ONLY));
  refresh();
  return ok("أُضيف البند. المجموع يُحسب تلقائياً.");
}

export async function removeQuoteItem(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("quote_items").delete().eq("id", id);
  if (error) return fail(dbMessage(error, DRAFT_ONLY));
  refresh();
  return ok("حُذف البند.");
}

export async function updateQuote(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const discount = parseMoneyToMinor(str(fd, "discount") || "0");
  if (!id || discount === null) return fail("الخصم غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("quotes").update({ discount, valid_until: optDate(fd, "valid_until") }).eq("id", id);
  if (error) return fail(dbMessage(error, { ...DRAFT_ONLY, "23514": "الخصم أكبر من المجموع." }));
  refresh();
  return ok("حُفظ العرض.");
}

export async function setQuoteStatus(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const to = pick(str(fd, "to"), ["sent", "rejected", "expired", "draft"] as const);
  if (!id || !to) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data: q } = await sb.from("quotes").select("status, total").eq("id", id).maybeSingle();
  if (!q) return fail("العرض غير موجود.");
  const allowed: Record<string, string[]> = { draft: ["sent"], sent: ["rejected", "expired", "draft"], expired: ["draft"], rejected: ["draft"] };
  if (!allowed[q.status]?.includes(to)) return fail("لا يمكن نقل العرض إلى هذه الحالة من حالته الحالية.");
  if (to === "sent" && q.total <= 0) return fail("أضف بنوداً قبل الإرسال.");
  const { error } = await sb.from("quotes").update({ status: to }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok(to === "sent" ? "أُرسل العرض؛ يظهر الآن للعميل في البوابة." : "حُدّثت حالة العرض.");
}

export async function deleteQuote(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error, count } = await sb.from("quotes").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(dbMessage(error));
  if (!count) return fail("يمكن حذف المسودات فقط.");
  redirect("/admin/quotes");
}
