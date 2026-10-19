"use server";

import { bookingSchema, trackSchema, type BookingState, type FieldErrors, type TrackState } from "./schema";
import { clientIp, getFormRpcClient, hashIp } from "./server";
import { turnstileMode, verifyTurnstile } from "./turnstile-policy";

const GENERIC_ERROR = "تعذّر إرسال الطلب الآن. بياناتك محفوظة في النموذج، حاول مرة أخرى بعد قليل.";

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" ? v : undefined;
}

export async function submitBooking(_prev: BookingState, fd: FormData): Promise<BookingState> {
  const idempotencyKey = str(fd, "idempotency_key") ?? "";
  if (!/^[A-Za-z0-9-]{8,128}$/.test(idempotencyKey)) {
    return { status: "error", message: GENERIC_ERROR };
  }

  const parsed = bookingSchema.safeParse({
    contact_name: str(fd, "contact_name") ?? "",
    contact_phone: str(fd, "contact_phone") ?? "",
    event_type: str(fd, "event_type") ?? "",
    event_date: str(fd, "event_date") ?? "",
    contact_email: str(fd, "contact_email"),
    city: str(fd, "city"),
    venue: str(fd, "venue"),
    guests: str(fd, "guests"),
    services: fd.getAll("services").filter((v): v is string => typeof v === "string"),
    message: str(fd, "message"),
  });
  if (!parsed.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as keyof FieldErrors;
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { status: "error", message: "راجع الحقول المحددة.", fieldErrors };
  }

  if (turnstileMode() === "unavailable") {
    return { status: "error", message: "النموذج غير متاح حالياً. تواصل معنا هاتفياً أو عبر واتساب." };
  }
  const ip = await clientIp();
  const human = await verifyTurnstile(str(fd, "cf-turnstile-response") ?? null, ip);
  if (!human) {
    return { status: "error", message: "تعذّر التحقق من النموذج. أعد المحاولة." };
  }

  const sb = await getFormRpcClient();
  if (!sb) {
    return { status: "error", message: "الخدمة غير متاحة حالياً. تواصل معنا مباشرة أو حاول لاحقاً." };
  }

  const d = parsed.data;
  const { data, error } = await sb.rpc("public_submit_booking", {
    p_contact_name: d.contact_name,
    p_contact_phone: d.contact_phone,
    p_event_type: d.event_type,
    p_idempotency_key: idempotencyKey,
    p_ip_hash: hashIp(ip),
    p_contact_email: d.contact_email ?? undefined,
    p_event_date: d.event_date ?? undefined,
    p_city: d.city ?? undefined,
    p_venue: d.venue ?? undefined,
    p_guests: d.guests ?? undefined,
    p_services: d.services ?? undefined,
    p_message: d.message ?? undefined,
  });

  if (error) {
    if (error.hint === "rate_limited" || /rate limited/i.test(error.message)) {
      return { status: "error", message: "وصلنا عدد كبير من الطلبات من هذا الجهاز. حاول بعد ساعة أو تواصل معنا." };
    }
    if (/past/i.test(error.message)) {
      return { status: "error", message: "تاريخ المناسبة مضى.", fieldErrors: { event_date: "اختر تاريخاً قادماً" } };
    }
    if (/phone/i.test(error.message)) {
      return { status: "error", message: "راجع رقم الهاتف.", fieldErrors: { contact_phone: "اكتب رقم هاتف صحيح" } };
    }
    return { status: "error", message: GENERIC_ERROR };
  }

  const code =
    typeof data === "string"
      ? data
      : data && typeof data === "object" && "tracking_code" in data
        ? String((data as { tracking_code: unknown }).tracking_code)
        : null;
  if (!code) return { status: "error", message: GENERIC_ERROR };
  return { status: "success", trackingCode: code };
}

export async function trackBooking(_prev: TrackState, fd: FormData): Promise<TrackState> {
  const parsed = trackSchema.safeParse({ code: str(fd, "code") ?? "", last4: str(fd, "last4") ?? "" });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "تحقق من البيانات." };
  }
  const sb = await getFormRpcClient();
  if (!sb) return { status: "error", message: "الخدمة غير متاحة حالياً. حاول لاحقاً." };
  const ip = await clientIp();
  const { data, error } = await sb.rpc("public_track_booking", {
    p_tracking_code: parsed.data.code,
    p_phone_last4: parsed.data.last4,
    p_ip_hash: hashIp(ip),
  });
  if (error) {
    if (error.hint === "rate_limited" || /rate limited/i.test(error.message)) {
      return { status: "error", message: "محاولات كثيرة. حاول بعد قليل." };
    }
    return { status: "error", message: "تعذّر جلب حالة الطلب الآن. حاول لاحقاً." };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { status: "not_found" };
  const r = row as { status?: string; event_date?: string | null; updated_at?: string | null };
  return {
    status: "found",
    bookingStatus: r.status ?? "new",
    eventDate: r.event_date ?? null,
    updatedAt: r.updated_at ?? null,
  };
}
