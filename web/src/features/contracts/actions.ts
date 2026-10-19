"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { parseMoneyToMinor } from "@/features/admin/money";
import type { TablesInsert } from "@/types/database";
import { dbMessage, fail, FORBIDDEN, ok, str, uuid, type ActionResult } from "@/features/admin/result";

// version_no and content_hash are assigned by the trigger and are not in the INSERT grant.
type VersionInsert = TablesInsert<"contract_versions">;

/** Contract from a quote: contract row (draft) + version 1 with the quote's computed total. */
export async function createContractFromQuote(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const quoteId = uuid(fd, "quote_id");
  const body = str(fd, "body");
  const deposit = parseMoneyToMinor(str(fd, "deposit") || "0");
  if (!quoteId || body.length < 10) return fail("اكتب نص العقد.");
  if (deposit === null) return fail("العربون غير صالح.");
  const sb = await createClient();
  const { data: q } = await sb.from("quotes").select("id, customer_id, event_id, total, currency, status").eq("id", quoteId).maybeSingle();
  if (!q) return fail("العرض غير موجود.");
  if (q.status === "draft" || q.status === "rejected") return fail("أرسل العرض أولاً، أو انتظر قبوله.");
  if (deposit > q.total) return fail("العربون أكبر من قيمة العقد.");
  const c = await sb.from("contracts").insert({ quote_id: q.id, customer_id: q.customer_id, event_id: q.event_id }).select("id").single();
  if (c.error || !c.data) return fail(dbMessage(c.error));
  const v = await sb
    .from("contract_versions")
    .insert({ contract_id: c.data.id, body: body.slice(0, 100000), total: q.total, deposit_required: deposit, currency: q.currency } as VersionInsert);
  if (v.error) return fail(`أُنشئ العقد لكن تعذّر حفظ النص: ${dbMessage(v.error)}`);
  redirect(`/admin/contracts/${c.data.id}`);
}

/** Versions are immutable; edits create a new version which becomes current. */
export async function addContractVersion(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const contractId = uuid(fd, "contract_id");
  const body = str(fd, "body");
  const total = parseMoneyToMinor(str(fd, "total"));
  const deposit = parseMoneyToMinor(str(fd, "deposit") || "0");
  if (!contractId || body.length < 10) return fail("اكتب نص العقد.");
  if (total === null || deposit === null) return fail("المبالغ غير صالحة.");
  if (deposit > total) return fail("العربون أكبر من قيمة العقد.");
  const sb = await createClient();
  // Withdraw from the customer BEFORE the new version exists, so an unreviewed version can never be approved.
  const withdraw = await sb.from("contracts").update({ status: "draft" }).eq("id", contractId).eq("status", "sent");
  if (withdraw.error) return fail(dbMessage(withdraw.error));
  const { error } = await sb
    .from("contract_versions")
    .insert({ contract_id: contractId, body: body.slice(0, 100000), total, deposit_required: deposit } as VersionInsert);
  if (error) return fail(dbMessage(error, { "42501": "لا يمكن إضافة نسخة لعقد معتمد أو ملغى." }));
  refresh();
  return ok("حُفظت نسخة جديدة وأصبحت الحالية. أرسلها للعميل عند الجاهزية.");
}

export async function sendContract(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data: c } = await sb.from("contracts").select("status, current_version_id").eq("id", id).maybeSingle();
  if (!c?.current_version_id) return fail("لا توجد نسخة لإرسالها.");
  if (c.status !== "draft") return fail("العقد ليس مسودة.");
  const { error } = await sb.from("contracts").update({ status: "sent" }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("أُرسل العقد للعميل للموافقة على النسخة الحالية.");
}

export async function voidContract(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("contracts").update({ status: "void" }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("أُلغي العقد. تبقى نسخه محفوظة للسجل.");
}
