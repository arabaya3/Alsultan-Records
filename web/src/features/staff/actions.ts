"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, optStr, str, uuid, type ActionResult } from "@/features/admin/result";

export async function saveStaff(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = str(fd, "id") ? uuid(fd, "id") : null;
  const full_name = str(fd, "full_name").slice(0, 200);
  if (!full_name) return fail("الاسم مطلوب.");
  const profileRaw = str(fd, "profile_id");
  const profile_id = profileRaw ? uuid(fd, "profile_id") : null;
  const row = {
    full_name,
    specialty: optStr(fd, "specialty")?.slice(0, 120) ?? null,
    phone: optStr(fd, "phone")?.slice(0, 32) ?? null,
    active: fd.get("active") === "on",
    profile_id,
  };
  const sb = await createClient();
  const { error } = id ? await sb.from("staff_members").update(row).eq("id", id) : await sb.from("staff_members").insert(row);
  if (error) return fail(dbMessage(error, { "23505": "هذا الحساب مرتبط بعضو طاقم آخر." }));
  refresh();
  return ok(id ? "حُفظ." : "أُضيف عضو الطاقم.");
}
