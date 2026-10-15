import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSessionProfile, STAFF_ROLES } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * Customer gate for portal pages. Signed out → /login?next=<returnPath>;
 * staff roles → /admin. RLS remains the real boundary.
 */
export async function requireCustomer(returnPath = "/portal") {
  // Session reads (JWT expiry checks use the clock) are request-time only.
  await connection();
  const session = await getSessionProfile();
  if (!session) redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  if (STAFF_ROLES.includes(session.role)) redirect("/admin");
  const supabase = await createClient();
  return { session, supabase };
}

/** For server actions: never redirect, just report. */
export async function customerForAction() {
  const session = await getSessionProfile();
  if (!session || session.role !== "customer") return null;
  const supabase = await createClient();
  return { session, supabase };
}

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: "auth" | "locked" | "forbidden" | "invalid" | "unavailable" };

export const MSG = {
  auth: "انتهت جلستك. سجّل الدخول من جديد للمتابعة.",
  unavailable: "تعذّر الحفظ الآن. تحقّق من الاتصال وحاول مرة أخرى.",
  forbidden: "لا يمكنك تنفيذ هذا الإجراء.",
  locked: "تم إرسال الاختيار ولم يعد قابلاً للتعديل.",
} as const;
