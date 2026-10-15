import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

/**
 * Short-lived signed URLs for private media thumbnails, minted with the
 * caller's own client (storage RLS decides). Local to admin until the shared
 * helper `@/features/media` (portal agent) is available.
 */
export async function signPaths(
  sb: SupabaseClient<Database>,
  paths: string[],
  seconds = 600,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data } = await sb.storage.from("private-media").createSignedUrls(chunk, seconds);
    for (const r of data ?? []) if (r.path && r.signedUrl) out.set(r.path, r.signedUrl);
  }
  return out;
}

export function thumbPath(variants: Json, fallback: string): string {
  if (variants && typeof variants === "object" && !Array.isArray(variants)) {
    const t = (variants as Record<string, Json>).thumb;
    if (typeof t === "string") return t;
  }
  return fallback;
}
