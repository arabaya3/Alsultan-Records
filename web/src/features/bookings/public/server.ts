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

/**
 * Client IP for rate limiting. The left-most X-Forwarded-For entry is client-controlled, so it is never used.
 * - CLIENT_IP_HEADER set (e.g. "cf-connecting-ip", "x-vercel-forwarded-for"): that header, written by the host's edge.
 * - otherwise: the RIGHT-most X-Forwarded-For entry, i.e. the address seen by the nearest proxy.
 * Without any proxy in front of `next start`, no header is trustworthy; the per-phone limit still applies.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const configured = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (configured) return h.get(configured)?.split(",")[0]?.trim() || "unknown";
  const chain = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return chain.at(-1) || h.get("x-real-ip")?.trim() || "unknown";
}

/** Keyed HMAC of the IP; the raw IP is never stored. */
export function hashIp(ip: string): string {
  const key = process.env.IP_HASH_SECRET;
  if (!key && process.env.NODE_ENV === "production") throw new Error("IP_HASH_SECRET is required");
  return createHmac("sha256", key ?? "local-dev-only").update(ip).digest("hex");
}

