"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { parseMoneyToMinor } from "@/features/admin/money";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, optDate, optStr, str, uuid, type ActionResult } from "@/features/admin/result";

const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

/** Owner only. One idempotency key per form instance: a resubmit (double click, retry) records nothing new. */
export async function recordPayment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const key = str(fd, "idempotency_key");
  const customerId = uuid(fd, "customer_id");
  const amount = parseMoneyToMinor(str(fd, "amount"));
  const kind = pick(str(fd, "kind"), ["payment", "refund"] as const);
  const method = str(fd, "method").slice(0, 60);
  const eventRaw = str(fd, "event_id");
  const eventId = eventRaw ? uuid(fd, "event_id") : null;
  const received = optDate(fd, "received_at");
  if (!KEY_RE.test(key)) return fail("أعد تحميل الصفحة وحاول مجدداً.");
  if (!customerId) return fail("اختر العميل.");
  if (amount === null || amount <= 0) return fail("المبلغ غير صالح. مثال: 1500 أو 1500.50");
  if (!kind || !method) return fail("اختر النوع وطريقة الدفع.");
  if (eventRaw && !eventId) return fail("مناسبة غير صالحة.");

  const sb = await createClient();
  const before = await sb.from("payments").select("id").eq("idempotency_key", key).maybeSingle();
  const { data, error } = await sb.rpc("record_payment", {
    p_customer_id: customerId,
    p_amount: amount,
    p_method: method,
    p_idempotency_key: key,
    p_kind: kind,
    p_event_id: eventId ?? undefined,
    p_received_at: received ? `${received}T12:00:00Z` : undefined,
    p_reference: optStr(fd, "reference")?.slice(0, 200) ?? undefined,
  });
  if (error)
    return fail(
      dbMessage(error, {
        "23505": "رقم العملية هذا استُخدم لدفعة مختلفة. أعد تحميل الصفحة لتسجيل دفعة جديدة.",
        "22023": "المناسبة لا تخص هذا العميل، أو البيانات غير صالحة.",
        "42501": "تسجيل الدفعات للمالك فقط.",
      }),
    );
  refresh();
  if (before.data) return ok("هذه الدفعة مسجّلة مسبقاً؛ لم يُسجّل شيء جديد.", { id: data, replay: true });
  return ok(kind === "refund" ? "سُجّل الاسترداد." : "سُجّلت الدفعة.", { id: data, replay: false });
}

export async function addExpense(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const amount = parseMoneyToMinor(str(fd, "amount"));
  const category = str(fd, "category").slice(0, 80);
  const eventRaw = str(fd, "event_id");
  const eventId = eventRaw ? uuid(fd, "event_id") : null;
  if (amount === null || amount <= 0) return fail("المبلغ غير صالح.");
  if (!category) return fail("اكتب التصنيف.");
  const sb = await createClient();
  const { error } = await sb.from("expenses").insert({
    amount,
    category,
    event_id: eventId,
    spent_at: optDate(fd, "spent_at") ?? undefined,
    note: optStr(fd, "note")?.slice(0, 1000) ?? null,
  });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("سُجّل المصروف.");
}

export async function deleteExpense(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("expenses").delete().eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُذف المصروف.");
}
