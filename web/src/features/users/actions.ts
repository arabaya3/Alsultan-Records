"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ALL_STAFF, guard, OWNER_ONLY } from "@/features/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { pick } from "@/features/admin/query";
import { dbMessage, fail, FORBIDDEN, ok, str, uuid, type ActionResult } from "@/features/admin/result";
import { Constants } from "@/types/database";

export async function setUserRole(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const id = uuid(fd, "id");
  const role = pick(str(fd, "role"), Constants.public.Enums.app_role);
  if (!id || !role) return fail("طلب غير صالح.");
  if (id === session.userId) return fail("لا يمكنك تغيير دورك بنفسك.");
  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_user_role", { p_user_id: id, p_role: role });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok("حُدّث الدور.");
}

export async function setUserDisabled(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const id = uuid(fd, "id");
  const disabled = str(fd, "disabled") === "1";
  if (!id) return fail("طلب غير صالح.");
  if (id === session.userId) return fail("لا يمكنك تعطيل حسابك.");
  const sb = await createClient();
  const { error } = await sb.rpc("admin_set_user_disabled", { p_user_id: id, p_disabled: disabled });
  if (error) return fail(dbMessage(error));
  refresh();
  return ok(disabled ? "عُطّل الحساب فوراً." : "أُعيد تفعيل الحساب.");
}

// ------------------------------------------------------------------ accounts & passwords
const PASSWORD = z.string().min(10, "كلمة السر لازم تكون 10 أحرف على الأقل.").max(72, "كلمة السر طويلة جداً (72 حرفاً حداً أقصى).");
const ACCOUNT_ROLES = ["owner", "admin", "staff", "customer"] as const;
const newAccount = z
  .object({
    full_name: z.string().trim().min(2, "اكتب الاسم.").max(120, "الاسم طويل جداً."),
    email: z.string().trim().toLowerCase().email("الإيميل غير صحيح.").max(254),
    role: z.enum(ACCOUNT_ROLES, { message: "اختر الصلاحية." }),
    password: PASSWORD,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "كلمتا السر غير متطابقتين." });

/**
 * Owner creates an account with a password and a role. Owner-only (server guard); the account is created with the
 * secret-key client (auth admin API, email pre-confirmed), then the role is set through the audited owner RPC
 * admin_set_user_role under the owner's own session. The password is never logged or returned.
 */
export async function createUserAccount(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const parsed = newAccount.safeParse({ full_name: str(fd, "full_name"), email: str(fd, "email"), role: str(fd, "role"), password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "بيانات غير صالحة.");
  const { full_name, email, role, password } = parsed.data;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return fail(taken ? "في حساب بهذا الإيميل أصلاً." : "تعذّر إنشاء الحساب. حاول مرة ثانية.");
  }
  if (role !== "customer") {
    const sb = await createClient();
    const r = await sb.rpc("admin_set_user_role", { p_user_id: data.user.id, p_role: role });
    if (r.error) return fail(`انعمل الحساب كعميل، بس تعذّر تعيين الصلاحية: ${dbMessage(r.error)} غيّرها من الجدول تحت.`);
  }
  refresh();
  return ok(`انعمل حساب ${full_name}. بيقدر يدخل هلّق بالإيميل وكلمة السر اللي حطيتها.`);
}

const changePassword = z
  .object({ current: z.string().min(1, "اكتب كلمة السر الحالية."), password: PASSWORD, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "كلمتا السر الجديدتان غير متطابقتين." })
  .refine((v) => v.password !== v.current, { message: "كلمة السر الجديدة لازم تختلف عن الحالية." });

/** Any staff/admin/owner changes their own password; the current password is verified first. */
export async function changeOwnPassword(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(ALL_STAFF);
  if (!session) return FORBIDDEN;
  if (!session.email) return fail("ما في إيميل مرتبط بهذا الحساب.");
  const parsed = changePassword.safeParse({ current: String(fd.get("current") ?? ""), password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "بيانات غير صالحة.");
  // Verify the current password on a throwaway client (no cookies touched).
  const probe = createSupabaseClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const check = await probe.auth.signInWithPassword({ email: session.email, password: parsed.data.current });
  if (check.error) return fail("كلمة السر الحالية غير صحيحة.");
  await probe.auth.signOut({ scope: "local" });
  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: parsed.data.password });
  if (error) return fail("تعذّر تغيير كلمة السر. حاول مرة ثانية.");
  return ok("تغيّرت كلمة السر. استعملها بالدخول الجاي.");
}

const resetPassword = z
  .object({ password: PASSWORD, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "كلمتا السر غير متطابقتين." });

/**
 * Owner sets a new password for another account (e.g. a forgotten one — there is no email reset). Owner-only server
 * guard; not for the owner's own account (that goes through /admin/account with the current password). Applied via the
 * auth admin API, then recorded in audit_events (who, whose account, when — never the password).
 */
export async function setUserPassword(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const session = await guard(OWNER_ONLY);
  if (!session) return FORBIDDEN;
  const id = uuid(fd, "id");
  if (!id) return fail("طلب غير صالح.");
  if (id === session.userId) return fail("لتغيير كلمة سرك استعمل صفحة «حسابي وكلمة السر».");
  const parsed = resetPassword.safeParse({ password: String(fd.get("password") ?? ""), confirm: String(fd.get("confirm") ?? "") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "بيانات غير صالحة.");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password: parsed.data.password });
  if (error) return fail("تعذّر تعيين كلمة السر. حاول مرة ثانية.");
  const audit = await admin.from("audit_events").insert({ actor: session.userId, action: "password_set_by_owner", entity_type: "auth.users", entity_id: id, after: { by: "owner" } });
  if (audit.error) return fail("تعيّنت كلمة السر، بس تعذّر تسجيلها بسجل التدقيق.");
  return ok("تعيّنت كلمة السر الجديدة. أعطيها للشخص بطريقة آمنة، وبيقدر يغيّرها من «حسابي وكلمة السر».");
}
