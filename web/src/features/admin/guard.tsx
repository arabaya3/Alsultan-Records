import "server-only";
import { connection } from "next/server";
import { PermissionError, requireRole, type AppRole, type SessionProfile } from "@/lib/permissions";

export const ADMIN_ROLES: AppRole[] = ["owner", "admin"];
export const ALL_STAFF: AppRole[] = ["owner", "admin", "staff"];
export const OWNER_ONLY: AppRole[] = ["owner"];

/**
 * Server-side page/action guard. Returns the session when the caller has one of
 * `roles`, or null when signed in with another role (render <Forbidden/> or
 * return FORBIDDEN). Signed-out users and staff sessions lacking aal2 are
 * redirected by requireRole (redirect errors are re-thrown).
 */
export async function guard(roles: AppRole[]): Promise<SessionProfile | null> {
  // Always request-time: the session read (JWT expiry check) must never be prerendered.
  await connection();
  try {
    return await requireRole(...roles);
  } catch (e) {
    if (e instanceof PermissionError) return null;
    throw e;
  }
}

export function Forbidden() {
  return (
    <div
      role="alert"
      data-testid="forbidden"
      className="rounded-md border border-danger/40 bg-danger/5 px-6 py-12 text-center"
    >
      <h1 className="font-display text-xl font-semibold">لا تملك صلاحية فتح هذه الصفحة</h1>
      <p className="mx-auto mt-2 max-w-md text-on-cream-muted">
        هذا القسم متاح لأدوار أخرى فقط. إن كنت تحتاجه فاطلب ذلك من المالك.
      </p>
    </div>
  );
}
