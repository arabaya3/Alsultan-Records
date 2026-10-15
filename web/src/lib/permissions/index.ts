import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type AppRole = Database["public"]["Enums"]["app_role"];
export const STAFF_ROLES: readonly AppRole[] = ["owner", "admin", "staff"];

export type SessionProfile = {
  userId: string;
  email: string | null;
  role: AppRole;
  fullName: string | null;
  aal: "aal1" | "aal2";
  mfaRequired: boolean;
};

export class PermissionError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "PermissionError";
  }
}

/**
 * Verified session + profile for the current request (memoized per request).
 * getClaims() verifies the JWT; the role is read from public.profiles (the
 * JWT app_role claim is only a hint). Returns null when signed out or disabled.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, disabled, mfa_required")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!profile || profile.disabled) return null;

  return {
    userId: profile.id,
    email: typeof claims.email === "string" ? claims.email : null,
    role: profile.role,
    fullName: profile.full_name,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    mfaRequired: profile.mfa_required,
  };
});

/**
 * Require one of the given roles. Signed-out users are redirected to /login;
 * signed-in users with another role get a PermissionError. Staff roles are
 * additionally passed through requireAal2ForStaff().
 */
export async function requireRole(...roles: AppRole[]): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (!roles.includes(session.role)) throw new PermissionError();
  if (STAFF_ROLES.includes(session.role)) await requireAal2ForStaff(session);
  return session;
}

/**
 * Staff/admin/owner sessions must be aal2 when MFA is required (globally via
 * app_settings.require_staff_mfa, or per profile.mfa_required). The database
 * enforces the same rule in RLS (app.mfa_ok()); this helper is the UX gate
 * that sends the user to step up instead of rendering empty pages.
 */
export async function requireAal2ForStaff(session?: SessionProfile): Promise<void> {
  const s = session ?? (await getSessionProfile());
  if (!s) redirect("/login");
  if (!STAFF_ROLES.includes(s.role) || s.aal === "aal2") return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_mfa_required");
  // Fail closed: if we cannot tell, require MFA.
  if (error || data !== false) redirect("/login?step=mfa");
}
