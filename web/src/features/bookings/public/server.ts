import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Secret-key client for the public form RPCs, which are granted to service_role ONLY.
 * Called exclusively from server actions after input validation + Turnstile verification.
 * Returns null when server env is missing so pages render the "unavailable" state.
 */
export async function getFormRpcClient(): Promise<ReturnType<typeof createAdminClient> | null> {
  try {
    // Lazy import: the env module throws at load time when server env is missing.
    const { createAdminClient } = await import("@/lib/supabase/admin");
    return createAdminClient();
  } catch {
    return null;
  }
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** Keyed HMAC of the IP; the raw IP is never stored. */
export function hashIp(ip: string): string {
  const key = process.env.IP_HASH_SECRET;
  if (!key && process.env.NODE_ENV === "production") throw new Error("IP_HASH_SECRET is required");
  return createHmac("sha256", key ?? "local-dev-only").update(ip).digest("hex");
}

/** Verifies a Turnstile token when a secret is configured; passes when it is not. */
export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY ?? process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      cache: "no-store",
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
