import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { serverEnv } from "@/lib/env/server";

/**
 * Secret-key client. BYPASSES RLS. Use only in audited server code paths that
 * cannot be expressed with RLS, AFTER an explicit authorization check:
 *  - public form RPCs (public_submit_booking, public_track_booking,
 *    public_submit_support, public_track_support) after Turnstile verification
 *    — these RPCs are granted to service_role only;
 *  - minting short-lived signed URLs after an RLS-checked ownership query;
 *  - auth admin createUser in features/users/actions.ts (owner-only guard; role then set via the audited RPC).
 * Never forward user-controlled table names or filters.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}
