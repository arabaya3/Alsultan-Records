"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { parseMoneyToMinor } from "@/features/admin/money";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, optStr, str, uuid, type ActionResult } from "@/features/admin/result";
import { Constants } from "@/types/database";

export async function saveEquipment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = str(fd, "id") ? uuid(fd, "id") : null;
  const name = str(fd, "name").slice(0, 200);
  const status = pick(str(fd, "status") || "available", Constants.public.Enums.equipment_status);
  if (!name || !status) return fail("الاسم مطلوب.");
  const row = { name, serial: optStr(fd, "serial")?.slice(0, 120) ?? null, status };
  const sb = await createClient();
  const { error } = id ? await sb.from("equipment").update(row).eq("id", id) : await sb.from("equipment").insert(row);
  if (error) return fail(dbMessage(error, { "23505": "الرقم التسلسلي مستخدم لمعدّة أخرى." }));
  refresh();
  return ok("حُفظت المعدّة.");
}

export async function addMaintenance(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const equipmentId = uuid(fd, "equipment_id");
  const description = str(fd, "description").slice(0, 1000);
  const costRaw = str(fd, "cost");
  const cost = costRaw ? parseMoneyToMinor(costRaw) : null;
  if (!equipmentId || !description) return fail("اكتب وصف الصيانة.");
  if (costRaw && cost === null) return fail("التكلفة غير صالحة.");
  const sb = await createClient();
  const { error } = await sb.from("equipment_maintenance").insert({ equipment_id: equipmentId, description, cost });
  if (error) return fail(dbMessage(error));
  await sb.from("equipment").update({ status: "maintenance" }).eq("id", equipmentId).neq("status", "retired");
  refresh();
  return ok("سُجّلت الصيانة وحالة المعدّة الآن «صيانة».");
}

export async function finishMaintenance(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb
    .from("equipment_maintenance")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", id)
    .select("equipment_id")
    .maybeSingle();
  if (error) return fail(dbMessage(error));
  if (data) await sb.from("equipment").update({ status: "available" }).eq("id", data.equipment_id).eq("status", "maintenance");
  refresh();
  return ok("انتهت الصيانة.");
}
