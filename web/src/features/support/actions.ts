"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { Constants } from "@/types/database";

export async function replySupport(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "request_id");
  const body = str(fd, "body").slice(0, 5000);
  if (!id || !body) return fail("اكتب الرد.");
  const sb = await createClient();
  const { error } = await sb.from("support_messages").insert({ request_id: id, body });
  if (error) return fail(dbMessage(error));
  const next = pick(str(fd, "then_status"), Constants.public.Enums.support_status);
  if (next) await sb.from("support_requests").update({ status: next }).eq("id", id);
  refresh();
  return ok("أُرسل الرد.");
}

export async function setSupportStatus(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const status = pick(str(fd, "status"), Constants.public.Enums.support_status);
  if (!id || !status) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("support_requests").update({ status }).eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُدّثت الحالة.");
}
