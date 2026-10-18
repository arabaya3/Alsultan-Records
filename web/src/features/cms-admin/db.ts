import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Session (RLS) client for the CMS tables from docs/cms-contract.md. Typed loosely so this area compiles
 * before/independently of the regenerated `types/database.ts`; every write is Zod-validated first and RLS
 * (app.is_admin()) is the authority. Never pass user-controlled table or column names.
 */
export async function cms(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

/** Today's date in Asia/Hebron (same rule as app.hebron_today()). */
export function hebronToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
