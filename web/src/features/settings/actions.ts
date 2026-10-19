"use server";

import { refresh, updateTag } from "next/cache";
import { TAGS } from "@/lib/cache-tags";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES, OWNER_ONLY } from "@/features/admin/guard";
import { dbMessage, fail, FORBIDDEN, ok, optStr, str, type ActionResult } from "@/features/admin/result";
import type { Json } from "@/types/database";
import { whatsappLinkUrl, youtubeChannelUrl } from "@/features/videos-admin/schema";
import { MODULES } from "@/features/admin/nav";

const urlOrNull = z.url("رابط غير صالح").max(500).nullable();

export async function saveBusinessSettings(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const parsed = z
    .object({
      name: z.string().min(1, "الاسم مطلوب").max(200),
      tagline: z.string().max(300).nullable(),
      phone: z.string().max(32).nullable(),
      whatsapp: z.string().max(32).nullable(),
      email: z.email("بريد غير صالح").nullable(),
      address: z.string().max(300).nullable(),
      instagram: urlOrNull,
      facebook: urlOrNull,
      canonical_base_url: urlOrNull,
      youtube_url: youtubeChannelUrl,
      whatsapp_url: whatsappLinkUrl,
    })
    .safeParse({
      name: str(fd, "name"),
      tagline: optStr(fd, "tagline"),
      phone: optStr(fd, "phone"),
      whatsapp: optStr(fd, "whatsapp"),
      email: optStr(fd, "email"),
      address: optStr(fd, "address"),
      instagram: optStr(fd, "instagram"),
      facebook: optStr(fd, "facebook"),
      canonical_base_url: optStr(fd, "canonical_base_url"),
      youtube_url: optStr(fd, "youtube_url"),
      whatsapp_url: optStr(fd, "whatsapp_url"),
    });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { error } = await sb.from("business_settings").update(parsed.data).eq("id", 1);
  if (error) return fail(dbMessage(error));
  updateTag(TAGS.business);
  updateTag(TAGS.siteContent);
  updateTag(TAGS.nav);
  refresh();
  return ok("حُفظت بيانات النشاط وظهرت في الموقع العام.");
}

export async function saveAppSettings(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  let rules: Json = {};
  const raw = str(fd, "booking_rules") || "{}";
  try {
    rules = JSON.parse(raw) as Json;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new Error();
  } catch {
    return fail("قواعد الحجز يجب أن تكون كائن JSON صالحاً.");
  }
  const sb = await createClient();
  const { error } = await sb
    .from("app_settings")
    .update({ require_staff_mfa: fd.get("require_staff_mfa") === "on", turnstile_enabled: fd.get("turnstile_enabled") === "on", booking_rules: rules })
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
