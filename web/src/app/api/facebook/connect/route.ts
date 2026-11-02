import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { guard, OWNER_ONLY } from "@/features/admin/guard";
import { authorizeUrl, metaEnv } from "@/features/facebook/oauth";

/** Owner only: sends the owner to Facebook Login. The state cookie ties the answer to this browser. */
export async function GET(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  if (!(await guard(OWNER_ONLY))) return new Response("Forbidden", { status: 403 });
  const m = metaEnv();
  if (!m) return NextResponse.redirect(`${origin}/admin/settings/facebook`);
  const state = randomBytes(24).toString("hex");
  (await cookies()).set("fb_oauth_state", state, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/facebook", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(m, `${origin}/api/facebook/callback`, state));
}
