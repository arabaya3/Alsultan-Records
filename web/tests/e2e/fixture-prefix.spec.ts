import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { db, PUB_KEY, SB_URL } from "./qa-helpers";

/**
 * Migration 0038: the purge prefixes [STAGING-TEST] / [RESTORE-TEST] are reserved. A real sign-up through GoTrue
 * (session supabase_auth_admin, the path pgTAP cannot simulate) cannot take one through its metadata, so no visitor can
 * get their records treated as test fixtures. An ordinary sign-up still works. LOCAL STACK ONLY (needs sign-up enabled
 * in supabase/config.toml, as it is for the local stack); every account created here is deleted.
 */
const anon = () => createClient(SB_URL, PUB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const email = (k: string) => `e2e-prefix-${k}-${Date.now()}@example.test`;

test("a sign-up cannot take a fixture prefix; an ordinary sign-up works", async () => {
  const created: string[] = [];
  try {
    const bad = await anon().auth.signUp({ email: email("bad"), password: "E2e-prefix-2026!", options: { data: { full_name: "[STAGING-TEST] me" } } });
    expect(bad.error, "the prefixed sign-up is refused").not.toBeNull();
    if (bad.data.user) created.push(bad.data.user.id);
    expect((await db.from("customers").select("id", { count: "exact", head: true }).eq("full_name", "[STAGING-TEST] me")).count).toBe(0);

    const ok = await anon().auth.signUp({ email: email("ok"), password: "E2e-prefix-2026!", options: { data: { full_name: "E2E Ordinary" } } });
    expect(ok.error).toBeNull();
    expect(ok.data.user).toBeTruthy();
    created.push(ok.data.user!.id);
    const row = (await db.from("customers").select("full_name").eq("user_id", ok.data.user!.id).single()).data;
    expect(row?.full_name).toBe("E2E Ordinary");
  } finally {
    for (const id of created) await db.auth.admin.deleteUser(id);
  }
});
