"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { Constants } from "@/types/database";

export async function setUserRole(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const id = uuid(fd, "id");
  const role = pick(str(fd, "role"), Constants.public.Enums.app_role);
  if (!id || !role) return fail("طلب غير صالح.");
  if (id === session.userId) return fail("لا يمكنك تغيير دورك بنفسك.");
  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_user_role", { p_user_id: id, p_role: role });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok(role === "customer" ? "حُدّث الدور." : "حُدّث الدور. سيُطلب منه التحقق بخطوتين عند الدخول.");
}

export async function setUserDisabled(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const id = uuid(fd, "id");
  const disabled = str(fd, "disabled") === "1";
  if (!id) return fail("طلب غير صالح.");
  if (id === session.userId) return fail("لا يمكنك تعطيل حسابك.");
  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_user_disabled", { p_user_id: id, p_disabled: disabled });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok(disabled ? "عُطّل الحساب فوراً." : "أُعيد تفعيل الحساب.");
}
