"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { publicEnv } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "./redirect";

export type AuthState = { status: "idle" | "error" | "sent"; message?: string; email?: string };

const STAFF = new Set(["owner", "admin", "staff"]);
const emailSchema = z.email("أدخل بريداً إلكترونياً صحيحاً.").max(320);
const GENERIC = "تعذّر إتمام العملية الآن. حاول مرة أخرى بعد قليل.";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
}

/** Base URL for links sent by email: ONLY the configured site URL — never request headers a client can forge. */
async function origin() {
  return publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
}

async function landing(next: string): Promise<string> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return "/login";
  const { data: profile } = await supabase.from("profiles").select("role, disabled").eq("id", uid).maybeSingle();
  if (!profile || profile.disabled) {
    await supabase.auth.signOut();
    return "/login?error=disabled";
  }
  const staff = STAFF.has(profile.role);
  if (staff) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.currentLevel !== "aal2") {
      const { data: required } = await supabase.rpc("staff_mfa_required");
      if (required !== false) return `/login?step=mfa&next=${encodeURIComponent(safeNext(next, "staff"))}`;
    }
  }
  return safeNext(next, staff ? "staff" : "customer");
}

export async function signInWithPassword(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(str(fd, "email").trim());
  const password = str(fd, "password");
  if (!email.success || !password) return { status: "error", message: "أدخل البريد الإلكتروني وكلمة المرور.", email: str(fd, "email") };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) {
    const msg = error.status === 400 || error.code === "invalid_credentials"
      ? "البريد الإلكتروني أو كلمة المرور غير صحيحة."
      : error.status === 429 ? "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً." : GENERIC;
    return { status: "error", message: msg, email: email.data };
  }
  redirect(await landing(str(fd, "next")));
}

export async function sendMagicLink(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(str(fd, "email").trim());
  if (!email.success) return { status: "error", message: "أدخل بريداً إلكترونياً صحيحاً." };
  const supabase = await createClient();
  const next = safeNext(str(fd, "next"), null);
  await supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  // Same answer whether or not the account exists (no account enumeration).
  return { status: "sent", message: "إن كان البريد مسجّلاً لدينا، فستصلك رسالة فيها رابط الدخول خلال دقائق." };
}

export async function requestPasswordReset(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(str(fd, "email").trim());
  if (!email.success) return { status: "error", message: "أدخل بريداً إلكترونياً صحيحاً." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent("/auth/reset")}`,
  });
  return { status: "sent", message: "إن كان البريد مسجّلاً لدينا، فستصلك رسالة لإعادة تعيين كلمة المرور." };
}

const passwordSchema = z.string().min(10, "كلمة المرور يجب أن تكون ١٠ أحرف على الأقل.").max(128);

export async function updatePassword(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const pw = passwordSchema.safeParse(str(fd, "password"));
  if (!pw.success) return { status: "error", message: pw.error.issues[0]?.message };
  if (str(fd, "password") !== str(fd, "confirm")) return { status: "error", message: "كلمتا المرور غير متطابقتين." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { status: "error", message: "انتهت صلاحية رابط إعادة التعيين. اطلب رابطاً جديداً." };
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return { status: "error", message: error.code === "same_password" ? "اختر كلمة مرور مختلفة عن السابقة." : GENERIC };
  await supabase.auth.signOut({ scope: "others" }); // a reset ends every other session of the account
  redirect(await landing(""));
}

export async function verifyMfa(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const code = str(fd, "code").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { status: "error", message: "أدخل الرمز المكوّن من ٦ أرقام." };
  const supabase = await createClient();
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) return { status: "error", message: "انتهت جلستك. سجّل الدخول من جديد." };
  const factorId = str(fd, "factorId") || factors?.totp?.[0]?.id || factors?.all?.find((f) => f.factor_type === "totp")?.id;
  if (!factorId) return { status: "error", message: "لا يوجد تطبيق مصادقة مرتبط بحسابك." };
  const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (vErr) return { status: "error", message: "الرمز غير صحيح أو انتهت صلاحيته." };
  redirect(safeNext(str(fd, "next"), "staff"));
}

/** Starts TOTP enrollment for a signed-in user who has no verified factor yet. */
export async function enrollMfa(): Promise<{ ok: true; factorId: string; qr: string; secret: string } | { ok: false; message: string }> {
  const supabase = await createClient();
  const { data: factors, error } = await supabase.auth.mfa.listFactors();
  if (error) return { ok: false, message: "انتهت جلستك. سجّل الدخول من جديد." };
  if (factors?.totp?.length) return { ok: false, message: "لديك تطبيق مصادقة مرتبط بالفعل. أدخل الرمز منه." };
  // Clean up abandoned unverified factors before enrolling again.
  for (const f of factors?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `totp-${Date.now()}` });
  if (e || !data) return { ok: false, message: GENERIC };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // The caller (LogoutButton) does a hard navigation so every in-memory client cache is dropped.
  return { ok: true as const };
}
