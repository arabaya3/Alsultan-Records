"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES, OWNER_ONLY } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, optStr, str, uuid, type ActionResult } from "@/features/admin/result";

const customerSchema = z.object({
  full_name: z.string().min(1, "الاسم مطلوب").max(200),
  phone: z.string().max(32).nullable(),
  email: z.email("بريد غير صالح").max(320).nullable(),
  city: z.string().max(120).nullable(),
});

function readCustomer(fd: FormData) {
  return customerSchema.safeParse({
    full_name: str(fd, "full_name"),
    phone: optStr(fd, "phone"),
    email: optStr(fd, "email"),
    city: optStr(fd, "city"),
  });
}

export async function createCustomer(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = readCustomer(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { data, error } = await sb
    .from("customers")
    .insert({ ...parsed.data, notes: optStr(fd, "notes") })
    .select("id")
    .single();
  if (error || !data) return fail(dbMessage(error));
  redirect(`/admin/customers/${data.id}`);
}

export async function updateCustomer(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const parsed = readCustomer(fd);
  if (!id || !parsed.success) return fail(parsed.success ? "طلب غير صالح." : (parsed.error.issues[0]?.message ?? "راجع الحقول."));
  const sb = await createClient();
  const { error } = await sb.from("customers").update(parsed.data).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُفظت بيانات العميل.");
}

export async function updateCustomerNotes(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const notes = str(fd, "notes").slice(0, 10000) || null;
  const sb = await createClient();
  const { error } = await sb.from("customers").update({ notes }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُفظت الملاحظات الداخلية.");
}

export async function linkCustomerUser(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const raw = str(fd, "user_id");
  const userId = raw === "" ? null : uuid(fd, "user_id");
  if (!id || (raw !== "" && !userId)) return fail("اختر حساباً صالحاً.");
  const sb = await createClient();
  // p_user_id null unlinks; the generated type is non-null, the RPC accepts null.
  const { error } = await sb.rpc("admin_link_customer_user", { p_customer_id: id, p_user_id: userId as string });
  if (error)
    return fail(
      dbMessage(error, {
        "22023": "الحساب المختار ليس حساب عميل.",
        "23505": "هذا الحساب مرتبط بسجل عميل آخر. افصل الربط هناك أولاً.",
      }),
    );
  refresh();
  return ok(userId ? "رُبط الحساب بالعميل." : "أُلغي ربط الحساب.");
}

export async function deleteCustomer(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error, count } = await sb.from("customers").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(dbMessage(error, { "23503": "لا يمكن حذف عميل لديه مناسبات أو عروض أو دفعات. يمكن إبقاؤه دون نشاط." }));
  if (!count) return fail("لم يُحذف شيء.");
  redirect("/admin/customers");
}
