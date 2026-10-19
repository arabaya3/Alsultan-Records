import "server-only";

/**
 * Bot-protection policy for public forms. There is no silent bypass:
 *  - "enforce"            both keys configured → every submission is verified server-side.
 *  - "bypass-dev"         `next dev` without keys.
 *  - "bypass-local-stack" production build whose Supabase is the LOCAL stack (127.0.0.1/localhost),
 *                         used only by the automated test suites; it can never apply to a cloud project.
 *  - "unavailable"        any other production build without BOTH keys → the form is shown disabled
 *                         and the server action refuses every submission.
 * Every bypass is logged once per process.
 */
export type TurnstileMode = "enforce" | "bypass-dev" | "bypass-local-stack" | "unavailable";

let logged = false;

export function turnstileMode(): TurnstileMode {
  const site = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (site && secret) return "enforce";
  let mode: TurnstileMode = "unavailable";
  if (process.env.NODE_ENV !== "production") mode = "bypass-dev";
  else if (isLocalSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL)) mode = "bypass-local-stack";
  if (!logged) {
    logged = true;
    const missing = [!site && "NEXT_PUBLIC_TURNSTILE_SITE_KEY", !secret && "TURNSTILE_SECRET_KEY"].filter(Boolean).join(", ");
    console.warn(`[turnstile] ${mode}: missing ${missing}${mode === "unavailable" ? " — public forms are refused" : ""}`);
  }
  return mode;
}

function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Server-side verification. Returns false whenever the policy does not allow the submission. */
export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const mode = turnstileMode();
  if (mode === "bypass-dev" || mode === "bypass-local-stack") return true;
  if (mode === "unavailable") return false;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
