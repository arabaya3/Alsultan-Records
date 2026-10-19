"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { guard, ADMIN_ROLES } from "@/features/admin/guard";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { Constants } from "@/types/database";

/** The database state machine (trigger) is the authority: invalid transitions are rejected there. */
export async function transitionBooking(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  const to = pick(str(fd, "to"), Constants.public.Enums.booking_status);
  if (!id || !to) return fail("طلب غير صالح.");
  const note = str(fd, "note").slice(0, 2000) || undefined;
  const sb = await createClient();
  const { error } = await sb.rpc("transition_booking", { p_booking_id: id, p_to: to, p_note: note });
  if (error) return fail(dbMessage(error, { "22023": "لا يمكن نقل الطلب إلى هذه المرحلة من مرحلته الحالية." }));
  refresh();
  return ok("حُدّثت مرحلة الطلب.");
}

/**
 * Convert a booking into customer + event. Reuses the linked customer when
 * present. Not a single transaction: if the event insert fails after a new
 * customer was created, the customer remains and the message says so.
 */
export async function convertBooking(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  if (!(await guard(ADMIN_ROLES))) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  const sb = await createClient();
  const { data: b, error } = await sb
    .from("booking_requests")
    .select("id, customer_id, contact_name, contact_phone, contact_email, event_type, event_date, city, venue")
    .eq("id", id)
    .maybeSingle();
  if (error || !b) return fail(dbMessage(error));

  const existing = await sb.from("events").select("id").eq("booking_request_id", id).limit(1).maybeSingle();
  if (existing.data) redirect(`/admin/events/${existing.data.id}`);

  let customerId = b.customer_id;
  let createdCustomer = false;
  if (!customerId) {
    const c = await sb
      .from("customers")
      .insert({ full_name: b.contact_name, phone: b.contact_phone, email: b.contact_email, city: b.city })
      .select("id")
      .single();
    if (c.error || !c.data) return fail(dbMessage(c.error));
    customerId = c.data.id;
    createdCustomer = true;
    const link = await sb.from("booking_requests").update({ customer_id: customerId }).eq("id", id);
    if (link.error) return fail(`أُنشئ العميل لكن تعذّر ربطه بالطلب: ${dbMessage(link.error)}`);
  }
  const title = str(fd, "title") || `${b.contact_name} – ${b.event_type}`;
  const ev = await sb
    .from("events")
    .insert({
      customer_id: customerId,
      booking_request_id: id,
      title: title.slice(0, 200),
      event_type: b.event_type,
      event_date: b.event_date,
      venue: b.venue,
      city: b.city,
    })
    .select("id")
    .single();
  if (ev.error || !ev.data) {
    return fail(
      `${createdCustomer ? "أُنشئ سجل العميل، لكن " : ""}تعذّر إنشاء المناسبة: ${dbMessage(ev.error)}`,
    );
  }
  redirect(`/admin/events/${ev.data.id}`);
}
