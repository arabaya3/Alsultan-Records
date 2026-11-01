import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { metaEnv, pageFromCode } from "@/features/facebook/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Facebook returns here. Owner only, state checked; the Page token goes to Vault and never to the browser or a log. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const done = (result: string) => NextResponse.redirect(`${url.origin}/admin/settings/facebook?result=${result}`);
  if (!(await guard(OWNER_ONLY))) return new Response("Forbidden", { status: 403 });
  const jar = await cookies();
  const expected = jar.get("fb_oauth_state")?.value ?? "";
  jar.delete({ name: "fb_oauth_state", path: "/api/facebook" });
  const state = url.searchParams.get("state") ?? "";
  if (!expected || !same(state, expected)) return done("state");
  const code = url.searchParams.get("code");
  const m = metaEnv();
  if (!code || !m) return done("denied");
  let page;
  try {
    page = await pageFromCode((u, i) => fetch(u, i), m, `${url.origin}/api/facebook/callback`, code);
  } catch {
    return done("meta_error");
  }
  if (!page.ok) return done(page.reason);
  const { error } = await (createAdminClient() as unknown as SupabaseClient).rpc("meta_connect", { p_page_id: page.id, p_page_name: page.name, p_token: page.token });
  return done(error ? "save" : "connected");
}
