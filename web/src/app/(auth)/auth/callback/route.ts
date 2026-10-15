import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/features/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set(["magiclink", "recovery", "invite", "email", "signup", "email_change"]);

/** Completes magic-link / recovery / invite flows (PKCE code or token_hash), then redirects same-origin only. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"), null);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await createClient();

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })).error;
  }

  const target = new URL(ok ? (type === "recovery" ? "/auth/reset" : next) : "/login?error=link", url.origin);
  return NextResponse.redirect(target);
}
