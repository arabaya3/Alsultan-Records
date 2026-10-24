"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, type ActionResult } from "@/features/admin/result";
import { MODULES } from "@/features/admin/nav";

/** Owner-only system switches. app_settings.booking_rules is no longer edited here: nothing in the app reads it
 *  (docs/ui-audit-followup.md §9), so it is left exactly as stored — never overwritten from this form. */
export async function saveAppSettings(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const sb = await createClient();
  const { error } = await sb
    .from("app_settings")
    .update({ require_staff_mfa: fd.get("require_staff_mfa") === "on", turnstile_enabled: fd.get("turnstile_enabled") === "on" })
    .eq("id", 1);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُفظت إعدادات النظام.");
}

/** Owner-only: which operational sections appear in the sidebar (UX only; data and routes untouched). */
export async function saveEnabledModules(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const parsed = z
    .array(z.enum(MODULES, "قسم غير معروف."))
    .max(MODULES.length)
    .safeParse(fd.getAll("modules").map(String));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الاختيارات.");
  const enabled = MODULES.filter((m) => parsed.data.includes(m));
  const sb = await createClient();
  const { error } = await sb.from("app_settings").update({ enabled_modules: enabled }).eq("id", 1);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُفظت الأقسام المفعّلة وتحدّثت القائمة.");
}
