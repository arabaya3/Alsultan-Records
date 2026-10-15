"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES, OWNER_ONLY } from "@/features/admin/guard";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, optDate, optStr, str, uuid, type ActionResult } from "@/features/admin/result";
import { retractEventPublicCopies } from "@/features/publishing/server";
import { cleanupMessage, processStorageCleanup } from "@/features/publishing/cleanup";
import { Constants } from "@/types/database";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const eventSchema = z.object({
  title: z.string().min(1, "العنوان مطلوب").max(200),
  event_type: z.string().max(40).nullable(),
  event_date: z.string().nullable(),
  venue: z.string().max(200).nullable(),
  city: z.string().max(120).nullable(),
  status: z.enum(Constants.public.Enums.event_status),
  public_slug: z
    .string()
    .max(120)
    .regex(SLUG_RE, "الرابط العام: أحرف إنجليزية صغيرة وأرقام وشرطات فقط")
    .nullable(),
  seo_title: z.string().max(120).nullable(),
  seo_description: z.string().max(320).nullable(),
  highlight: z.string().max(500).nullable(),
  coverage_notes: z.string().max(5000).nullable(),
  production_note: z.string().max(5000).nullable(),
  equipment_note: z.string().max(5000).nullable(),
});

function readEvent(fd: FormData) {
  return eventSchema.safeParse({
    title: str(fd, "title"),
    event_type: optStr(fd, "event_type"),
    event_date: optDate(fd, "event_date"),
    venue: optStr(fd, "venue"),
    city: optStr(fd, "city"),
    status: str(fd, "status") || "planned",
    public_slug: optStr(fd, "public_slug")?.toLowerCase() ?? null,
    seo_title: optStr(fd, "seo_title"),
    seo_description: optStr(fd, "seo_description"),
    highlight: optStr(fd, "highlight"),
    coverage_notes: optStr(fd, "coverage_notes"),
    production_note: optStr(fd, "production_note"),
    equipment_note: optStr(fd, "equipment_note"),
  });
}
const SLUG_TAKEN = { "23505": "الرابط العام مستخدم لمناسبة أخرى." };

export async function createEvent(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const customerId = uuid(fd, "customer_id");
  if (!customerId) return fail("اختر العميل.");
  const parsed = readEvent(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { data, error } = await sb
    .from("events")
    .insert({ ...parsed.data, customer_id: customerId })
    .select("id")
    .single();
  if (error || !data) return fail(dbMessage(error, SLUG_TAKEN));
  redirect(`/admin/events/${data.id}`);
}

export async function updateEvent(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const parsed = readEvent(fd);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "راجع الحقول.");
  const sb = await createClient();
  const { error } = await sb.from("events").update(parsed.data).eq("id", id);
  if (error) return fail(dbMessage(error, { ...SLUG_TAKEN, "23514": "لا يمكن إزالة الرابط العام لمناسبة منشورة. أوقف النشر أولاً." }));
  refresh();
  return ok("حُفظت المناسبة.");
}

export async function deleteEvent(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(OWNER_ONLY))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error, count } = await sb.from("events").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(dbMessage(error, { "23503": "لا يمكن الحذف لوجود سجلات مرتبطة (عقود أو دفعات). غيّر الحالة إلى «مؤرشف» بدلاً من ذلك." }));
  if (!count) return fail("لم يُحذف شيء.");
  // The delete trigger queued every stored object of the event; remove them now.
  await processStorageCleanup(200);
  redirect("/admin/events");
}

// ------------------------------------------------------------- consent & publication
export async function setConsent(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const status = pick(str(fd, "consent"), Constants.public.Enums.consent_status);
  if (!id || !status) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_publication_consent", { p_event_id: id, p_status: status });
  if (error) return fail(dbMessage(error));
  let extra = "";
  if (status !== "granted") {
    const r = await retractEventPublicCopies(sb, id);
    if (r.message) extra = ` ${r.message}`;
  }
  refresh();
  return ok(`حُدّثت حالة الموافقة.${extra}`);
}

export async function setPublication(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const publish = str(fd, "publish") === "1";
  const featured = fd.get("featured") === "on";
  const orderRaw = str(fd, "featured_order");
  const order = orderRaw ? Number.parseInt(orderRaw, 10) : undefined;
  if (orderRaw && (!Number.isFinite(order) || (order ?? 0) < 0 || (order ?? 0) > 10000)) return fail("ترتيب العرض غير صالح.");
  const sb = await createClient();
  const { error } = await sb.rpc("set_event_publication", {
    p_event_id: id,
    p_publish: publish,
    p_featured: publish && featured,
    p_featured_order: publish && featured ? order : undefined,
  });
  if (error)
    return fail(
      dbMessage(error, {
        "42501": "لا يمكن النشر بدون موافقة العميل الممنوحة.",
        "22023": "أضف رابطاً عاماً للمناسبة واحفظه قبل النشر.",
      }),
    );
  let extra = "";
  if (!publish) {
    const r = await retractEventPublicCopies(sb, id);
    if (r.message) extra = ` ${r.message}`;
  }
  refresh();
  return ok(publish ? "نُشرت المناسبة في صفحة الأعمال." : `أُوقف النشر.${extra}`);
}

export async function cleanupPublic(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data: ev } = await sb.from("events").select("is_published, publication_consent").eq("id", id).maybeSingle();
  if (ev?.is_published && ev.publication_consent === "granted")
    return fail("المناسبة منشورة حالياً؛ أوقف نشر الصور فرادى من صفحة الوسائط.");
  const r = await retractEventPublicCopies(sb, id);
  refresh();
  return ok(`أُزيلت ${r.rows} نسخة عامة من السجل. ${r.message}`.trim());
}

// ------------------------------------------------------------- staff assignments
export async function assignStaff(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const eventId = uuid(fd, "event_id");
  const staffId = uuid(fd, "staff_id");
  if (!eventId || !staffId) return fail("اختر الشخص.");
  const sb = await createClient();
  const { error } = await sb.from("event_staff_assignments").insert({
    event_id: eventId,
    staff_id: staffId,
    role_label: optStr(fd, "role_label")?.slice(0, 80) ?? null,
    override_reason: optStr(fd, "override_reason")?.slice(0, 500) ?? null,
  });
  if (error) {
    if (error.code === "23P01")
      return fail(
        "تعارض: هذا الشخص مكلّف بمناسبة أخرى في نفس اليوم. إن كان الحجز المزدوج مقصوداً فاكتب سبب التجاوز ثم أعد الإرسال.",
        { conflict: true },
      );
    return fail(dbMessage(error, { "23505": "هذا الشخص مكلّف بهذه المناسبة مسبقاً." }));
  }
  refresh();
  return ok("أُضيف إلى طاقم المناسبة.");
}

export async function unassignStaff(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("event_staff_assignments").delete().eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("أُزيل من الطاقم.");
}

// ------------------------------------------------------------- equipment assignments
function toIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function assignEquipment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const eventId = uuid(fd, "event_id");
  const equipmentId = uuid(fd, "equipment_id");
  const outAt = toIso(str(fd, "out_at"));
  const returnedAt = toIso(str(fd, "returned_at"));
  if (!eventId || !equipmentId || !outAt) return fail("اختر المعدّة ووقت الاستلام.");
  if (returnedAt && returnedAt <= outAt) return fail("وقت الإرجاع يجب أن يكون بعد وقت الاستلام.");
  const sb = await createClient();
  const { error } = await sb
    .from("equipment_assignments")
    .insert({ event_id: eventId, equipment_id: equipmentId, out_at: outAt, returned_at: returnedAt });
  if (error)
    return fail(
      dbMessage(error, {
        "23P01": "تعارض: هذه المعدّة مُسلّمة لمناسبة أخرى في فترة متداخلة. أرجعها أولاً أو اختر فترة أخرى.",
      }),
    );
  if (!returnedAt) await sb.from("equipment").update({ status: "assigned" }).eq("id", equipmentId).eq("status", "available");
  refresh();
  return ok("سُجّل تسليم المعدّة.");
}

export async function returnEquipment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data, error } = await sb
    .from("equipment_assignments")
    .update({ returned_at: new Date().toISOString() })
    .eq("id", id)
    .is("returned_at", null)
    .select("equipment_id")
    .maybeSingle();
  if (error) return fail(dbMessage(error, { "23514": "وقت الإرجاع يسبق وقت الاستلام." }));
  if (data) await sb.from("equipment").update({ status: "available" }).eq("id", data.equipment_id).eq("status", "assigned");
  refresh();
  return ok("سُجّل الإرجاع.");
}

export async function removeEquipmentAssignment(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { error } = await sb.from("equipment_assignments").delete().eq("id", id);
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُذف السجل.");
}

/** Manual run of the storage cleanup queue (owner/admin). */
export async function runStorageCleanup(): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const r = await processStorageCleanup(100);
  refresh();
  const msg = cleanupMessage(r);
  return r.error || r.failed.length ? fail(msg, { failed: r.failed }) : ok(msg);
}
